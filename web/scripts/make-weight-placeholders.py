#!/usr/bin/env python3
"""Generate deterministic placeholder artwork for the daily-weight feature."""

# Placeholder: da sostituire con gli asset di art-prompts.md, stessi nomi file.

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, PngImagePlugin

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "art"
PLACEHOLDER_NOTE = "Placeholder: da sostituire con gli asset di art-prompts.md, stessi nomi file"
ICON_SIZE = (1024, 1024)
BACKGROUND_SIZE = (941, 1672)
GRID_SIZE = (32, 57)


def most_common_color(image: Image.Image, matches: Callable[[tuple[int, int, int]], bool], label: str) -> tuple[int, int, int]:
    source_colors = Counter(image.convert("RGBA").get_flattened_data())
    colors = Counter({
        color[:3]: count
        for color, count in source_colors.items()
        if color[3] >= 160 and matches(color[:3])
    })
    if not colors:
        raise ValueError(f"Could not sample {label} from {image.filename}")
    return colors.most_common(1)[0][0][:3]


def section_colors(mode: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    icon_source = Image.open(ART / mode / "icons.png").convert("RGBA")
    if mode == "dieta":
        accent = most_common_color(
            icon_source,
            lambda color: color[1] >= color[0] + 18 and color[1] >= color[2] - 8 and 50 <= color[0] <= 210 and 80 <= color[1] <= 220,
            "the sage section color",
        )
    else:
        accent = most_common_color(
            icon_source,
            lambda color: color[0] >= color[1] + 35 and color[0] >= 145 and color[1] >= 45 and color[2] >= 35,
            "the coral section color",
        )
    outline = most_common_color(
        icon_source,
        lambda color: color[0] > color[1] > color[2] and 20 <= color[0] <= 150 and color[1] <= 105 and color[2] <= 80,
        "the dark-brown outline color",
    )
    return accent, outline


def sample_cream(mode: str) -> tuple[int, int, int]:
    settings = Image.open(ART / mode / "settings.png").convert("RGB")
    return Counter(settings.get_flattened_data()).most_common(1)[0][0]


def rounded_scale(draw: ImageDraw.ImageDraw, center_x: int, top: int, width: int, height: int,
                  accent: tuple[int, int, int], outline: tuple[int, int, int],
                  cream: tuple[int, int, int]) -> None:
    left = center_x - width // 2
    right = left + width - 1
    bottom = top + height - 1
    draw.rounded_rectangle((left, top, right, bottom), radius=max(2, width // 5), fill=outline)
    inset = max(1, width // 12)
    draw.rounded_rectangle((left + inset, top + inset, right - inset, bottom - inset),
                           radius=max(1, width // 6), fill=accent)

    dial_width = max(5, width // 3)
    dial_left = center_x - dial_width // 2
    dial_top = top + max(2, height // 8)
    dial_right = dial_left + dial_width - 1
    dial_bottom = dial_top + max(4, height // 4)
    draw.rounded_rectangle((dial_left - 1, dial_top - 1, dial_right + 1, dial_bottom + 1),
                           radius=1, fill=outline)
    draw.rounded_rectangle((dial_left, dial_top, dial_right, dial_bottom),
                           radius=1, fill=cream)
    dial_center_x = (dial_left + dial_right) // 2
    dial_center_y = (dial_top + dial_bottom) // 2
    draw.point((dial_center_x, dial_center_y), fill=outline)
    draw.line((dial_center_x, dial_center_y, dial_center_x + max(1, dial_width // 5), dial_top + 1), fill=outline)

    # Small feet and a highlight make the silhouette read as a bathroom scale.
    foot_y = bottom - max(1, height // 8)
    for foot_x in (left + width // 4, right - width // 4):
        draw.rectangle((foot_x, foot_y, foot_x + 1, foot_y + 1), fill=outline)
    draw.line((left + inset + 2, top + height // 2, left + inset + 2, bottom - height // 4), fill=cream)


def save_icon(mode: str, accent: tuple[int, int, int], outline: tuple[int, int, int]) -> None:
    icon = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    draw = ImageDraw.Draw(icon)
    rounded_scale(draw, 16, 3, 24, 27, accent, outline, (253, 246, 229))
    image = icon.resize(ICON_SIZE, Image.Resampling.NEAREST)
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Comment", PLACEHOLDER_NOTE)
    image.save(ART / mode / "weight-icon.png", optimize=True, pnginfo=metadata)


def save_background(mode: str, accent: tuple[int, int, int], outline: tuple[int, int, int]) -> None:
    cream = sample_cream(mode)
    image = Image.new("RGB", GRID_SIZE, cream)
    draw = ImageDraw.Draw(image)
    rounded_scale(draw, 16, 35, 23, 20, accent, outline, cream)
    image = image.resize(BACKGROUND_SIZE, Image.Resampling.NEAREST)
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Comment", PLACEHOLDER_NOTE)
    image.save(ART / mode / "weight.png", optimize=True, pnginfo=metadata)


def main() -> None:
    for mode in ("dieta", "palestra"):
        accent, outline = section_colors(mode)
        save_icon(mode, accent, outline)
        save_background(mode, accent, outline)


if __name__ == "__main__":
    main()
