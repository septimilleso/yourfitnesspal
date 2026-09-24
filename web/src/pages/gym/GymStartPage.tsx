import ModeSwitch from "../../components/ModeSwitch";

function GymStartPage() {
  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Inizia allenamento</h1>
        </div>
      </header>
    </div>
  );
}

export default GymStartPage;
