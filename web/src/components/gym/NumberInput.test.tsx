import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import NumberInput from "./NumberInput";

describe("NumberInput", () => {
  it("shows and accepts a decimal comma", () => {
    const onChange = vi.fn();
    render(<NumberInput label="kg" kind="decimal" value={37.5} onChange={onChange} />);
    const input = screen.getByLabelText("kg");
    expect(input).toHaveValue("37,5");
    fireEvent.change(input, { target: { value: "40,25" } });
    expect(onChange).toHaveBeenLastCalledWith(40.25);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("ignores invalid text and values over the limit", () => {
    const onChange = vi.fn();
    render(<NumberInput label="Rip." kind="integer" value={8} onChange={onChange} />);
    const input = screen.getByLabelText("Rip.");
    fireEvent.change(input, { target: { value: "8a" } });
    fireEvent.change(input, { target: { value: "5000" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats durations as m:ss", () => {
    const onChange = vi.fn();
    render(<NumberInput label="Tempo" kind="duration" value={90} onChange={onChange} />);
    const input = screen.getByLabelText("Tempo");
    expect(input).toHaveValue("1:30");
    fireEvent.change(input, { target: { value: "2:05" } });
    expect(onChange).toHaveBeenLastCalledWith(125);
  });
});
