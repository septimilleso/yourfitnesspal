import ModeSwitch from "../../components/ModeSwitch";

function WorkoutPage() {
  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Allenamento in corso</h1>
        </div>
      </header>
    </div>
  );
}

export default WorkoutPage;
