import type { Folder } from "../../api/gym";
import Sheet from "./Sheet";

interface MoveToFolderSheetProps {
  folders: Folder[];
  currentFolderId: number | null;
  onPick: (folderId: number | null) => void;
  onClose: () => void;
}

function MoveToFolderSheet({ folders, currentFolderId, onPick, onClose }: MoveToFolderSheetProps) {
  const options: { id: number | null; name: string }[] = [{ id: null, name: "Nessuna cartella" }, ...folders];
  return (
    <Sheet title="Sposta in cartella" onClose={onClose}>
      <ul className="card divide-y divide-slate-100">
        {options.map((option) => (
          <li key={option.id ?? "none"}>
            <button
              type="button"
              aria-pressed={option.id === currentFolderId}
              onClick={() => onPick(option.id)}
              className="row w-full justify-between text-left text-[15px] text-slate-900 active:bg-slate-50"
            >
              {option.name}
              {option.id === currentFolderId && <span className="text-sky-600">✓</span>}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export default MoveToFolderSheet;
