#!/usr/bin/env python3
"""Build optimized pixel-art assets and PWA icons from the source artwork."""

from __future__ import annotations

from collections import Counter
from math import ceil, sqrt
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art"
PUBLIC = ROOT / "public"
ICON_NAMES = {
    "dieta": [
        "cat", "plate", "cookbook", "basket",
        "egg", "salad", "soup", "apple",
        "water", "chart", "heart", "gear",
    ],
    "palestra": [
        "cat", "clipboard", "book", "calendar",
        "dumbbell", "shoe", "mat", "moon",
        "bottle", "chart", "medal", "gear",
    ],
}


def binary_alpha(image: Image.Image) -> Image.Image:
    """Discard translucent matte pixels and make the remaining art opaque."""
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A").point(lambda value: 255 if value >= 160 else 0)
    rgba.putalpha(alpha)
    return rgba


def remove_small_components(mask: Image.Image, minimum_area: int = 30) -> Image.Image:
    """Remove disconnected alpha components smaller than minimum_area."""
    width, height = mask.size
    pixels = mask.convert("L")
    rows: list[list[list[int]]] = []
    parents: list[int] = []
    sizes: list[int] = []

    def find(label: int) -> int:
        while parents[label] != label:
            parents[label] = parents[parents[label]]
            label = parents[label]
        return label

    def union(first: int, second: int) -> None:
        root_first = find(first)
        root_second = find(second)
        if root_first == root_second:
            return
        if sizes[root_first] < sizes[root_second]:
            root_first, root_second = root_second, root_first
        parents[root_second] = root_first
        sizes[root_first] += sizes[root_second]

    previous: list[list[int]] = []
    for y in range(height):
        row = pixels.crop((0, y, width, y + 1)).tobytes()
        spans: list[list[int]] = []
        x = 0
        while x < width:
            if row[x] == 0:
                x += 1
                continue
            start = x
            while x < width and row[x] != 0:
                x += 1
            label = len(parents)
            parents.append(label)
            sizes.append(x - start)
            spans.append([start, x, label])
            for old_start, old_end, old_label in previous:
                if old_end < start - 1:
                    continue
                if old_start > x:
                    break
                union(label, old_label)
        rows.append(spans)
        previous = spans

    cleaned = Image.new("L", mask.size, 0)
    draw = ImageDraw.Draw(cleaned)
    for y, spans in enumerate(rows):
        for start, end, label in spans:
            if sizes[find(label)] >= minimum_area:
                draw.line((start, y, end - 1, y), fill=255)
    return cleaned


def connected_regions(mask: Image.Image, minimum_area: int = 30) -> list[tuple[tuple[int, int, int, int], int]]:
    """Return bounding boxes and areas of connected alpha regions."""
    width, height = mask.size
    pixels = mask.convert("L")
    rows: list[list[list[int]]] = []
    parents: list[int] = []
    sizes: list[int] = []

    def find(label: int) -> int:
        while parents[label] != label:
            parents[label] = parents[parents[label]]
            label = parents[label]
        return label

    def union(first: int, second: int) -> None:
        root_first = find(first)
        root_second = find(second)
        if root_first == root_second:
            return
        if sizes[root_first] < sizes[root_second]:
            root_first, root_second = root_second, root_first
        parents[root_second] = root_first
        sizes[root_first] += sizes[root_second]

    previous: list[list[int]] = []
    for y in range(height):
        row = pixels.crop((0, y, width, y + 1)).tobytes()
        spans: list[list[int]] = []
        x = 0
        while x < width:
            if row[x] == 0:
                x += 1
                continue
            start = x
            while x < width and row[x] != 0:
                x += 1
            label = len(parents)
            parents.append(label)
            sizes.append(x - start)
            spans.append([start, x, label])
            for old_start, old_end, old_label in previous:
                if old_end < start - 1:
                    continue
                if old_start > x:
                    break
                union(label, old_label)
        rows.append(spans)
        previous = spans

    bounds: dict[int, list[int]] = {}
    for y, spans in enumerate(rows):
        for start, end, label in spans:
            root = find(label)
            if sizes[root] < minimum_area:
                continue
            if root not in bounds:
                bounds[root] = [start, y, end, y + 1]
            else:
                box = bounds[root]
                box[0] = min(box[0], start)
                box[1] = min(box[1], y)
                box[2] = max(box[2], end)
                box[3] = max(box[3], y + 1)
    return [(tuple(box), sizes[label]) for label, box in bounds.items()]


def clean_cutout(image: Image.Image) -> Image.Image:
    rgba = binary_alpha(image)
    alpha = remove_small_components(rgba.getchannel("A"))
    rgba.putalpha(alpha)
    return rgba


def trimmed_cutout(image: Image.Image) -> Image.Image:
    cleaned = clean_cutout(image)
    bbox = cleaned.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("The source image contains no visible art")
    return cleaned.crop(bbox)


def save_icon_sheet(mode: str) -> None:
    sheet = Image.open(ART / mode / "icons.png").convert("RGBA")
    cell_width = sheet.width // 4
    cell_height = sheet.height // 3
    out_dir = PUBLIC / "art" / ("diet" if mode == "dieta" else "gym") / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    groups: list[list[tuple[int, int, int, int]]] = [[] for _ in ICON_NAMES[mode]]
    alpha = binary_alpha(sheet).getchannel("A")
    for (left, top, right, bottom), _area in connected_regions(alpha):
        column = min(3, ((left + right) // 2) // cell_width)
        row = min(2, ((top + bottom) // 2) // cell_height)
        groups[row * 4 + column].append((left, top, right, bottom))

    for index, name in enumerate(ICON_NAMES[mode]):
        regions = groups[index]
        if not regions:
            raise ValueError(f"No icon art found for {mode}/{name}")
        bounds = (
            min(box[0] for box in regions),
            min(box[1] for box in regions),
            max(box[2] for box in regions),
            max(box[3] for box in regions),
        )
        art = trimmed_cutout(sheet.crop(bounds))
        side = max(art.size)
        margin = max(1, round(side * 0.06))
        canvas = Image.new("RGBA", (side + margin * 2, side + margin * 2), (0, 0, 0, 0))
        canvas.alpha_composite(art, ((canvas.width - art.width) // 2, (canvas.height - art.height) // 2))
        canvas = canvas.resize((96, 96), Image.Resampling.LANCZOS)
        canvas.save(out_dir / f"{name}.png", optimize=True)


def save_mascot(mode: str) -> None:
    mascot = trimmed_cutout(Image.open(ART / mode / "mascot.png"))
    width = round(mascot.width * 480 / mascot.height)
    mascot.resize((width, 480), Image.Resampling.LANCZOS).save(
        PUBLIC / "art" / ("diet" if mode == "dieta" else "gym") / "mascot.webp",
        "WEBP",
        quality=85,
        method=6,
    )


def save_backgrounds(mode: str) -> None:
    out_dir = PUBLIC / "art" / ("diet" if mode == "dieta" else "gym")
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in ("pattern", "scene"):
        image = Image.open(ART / mode / f"{name}.png").convert("RGB")
        if image.width > 941:
            height = round(image.height * 941 / image.width)
            image = image.resize((941, height), Image.Resampling.LANCZOS)
        image.save(out_dir / f"{name}.webp", "WEBP", quality=80, method=6)


def sage_color(image: Image.Image) -> tuple[int, int, int]:
    candidates = []
    for red, green, blue, alpha in image.get_flattened_data():
        if alpha >= 160 and green >= red + 18 and green >= blue - 8 and 50 <= red <= 210 and 80 <= green <= 220:
            candidates.append((red, green, blue))
    if not candidates:
        raise ValueError("Could not find the sage background in the Dieta app icon")
    return Counter(candidates).most_common(1)[0][0]


def green_square_crop(image: Image.Image, sage: tuple[int, int, int]) -> Image.Image:
    rgba = image.convert("RGBA")
    green_mask = Image.new("L", rgba.size, 0)
    mask_pixels = green_mask.load()
    source_pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = source_pixels[x, y]
            distance = sum((channel - target) ** 2 for channel, target in zip((red, green, blue), sage))
            if alpha >= 160 and distance <= 65**2:
                mask_pixels[x, y] = 255

    main_background = remove_small_components(green_mask, minimum_area=100)
    bbox = main_background.getbbox()
    if bbox is None:
        raise ValueError("Could not locate the sage rounded square")
    left, top, right, bottom = bbox
    side = min(right - left, bottom - top)
    center_x = (left + right) // 2
    center_y = (top + bottom) // 2
    left = center_x - side // 2
    top = center_y - side // 2
    return rgba.crop((left, top, left + side, top + side))


def pwa_icons() -> None:
    source = Image.open(ART / "dieta" / "app-icon.png").convert("RGBA")
    sage = sage_color(source)
    crop = green_square_crop(source, sage)
    rounded_mask = Image.new("L", crop.size, 0)
    ImageDraw.Draw(rounded_mask).rounded_rectangle(
        (0, 0, crop.width - 1, crop.height - 1),
        radius=round(crop.width * 0.21),
        fill=255,
    )
    clean = crop.copy()
    clean.putalpha(ImageChops.multiply(crop.getchannel("A"), rounded_mask))

    for size, filename in ((192, "pwa-192x192.png"), (512, "pwa-512x512.png"), (32, "favicon-32x32.png")):
        clean.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / filename, optimize=True)

    # Keep the largest axis-aligned square inside the rounded body so no corner
    # or outline pixels survive when this crop is scaled to full bleed.
    diameter = min(crop.size)
    radius = round(diameter * 0.21)
    inset = ceil(radius * (1 - 1 / sqrt(2))) + 2
    left = (crop.width - diameter) // 2 + inset
    top = (crop.height - diameter) // 2 + inset
    inner_side = diameter - inset * 2
    inner = crop.crop((left, top, left + inner_side, top + inner_side))
    opaque_inner = Image.new("RGBA", inner.size, (*sage, 255))
    opaque_inner.alpha_composite(inner)

    for size, filename in ((512, "pwa-maskable-512x512.png"), (180, "apple-touch-icon.png")):
        opaque_inner.resize((size, size), Image.Resampling.LANCZOS).convert("RGB").save(
            PUBLIC / filename,
            optimize=True,
        )


def report_outputs() -> None:
    for path in sorted((PUBLIC / "art").rglob("*")) + sorted(PUBLIC.glob("*.png")):
        if path.is_file():
            print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.1f} KB")


def main() -> None:
    for mode in ("dieta", "palestra"):
        save_icon_sheet(mode)
        save_mascot(mode)
        save_backgrounds(mode)
    pwa_icons()
    report_outputs()


if __name__ == "__main__":
    main()
