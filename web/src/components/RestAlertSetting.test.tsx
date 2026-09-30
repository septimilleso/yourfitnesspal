import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getPushConfig, subscribePush } = vi.hoisted(() => ({
  getPushConfig: vi.fn(),
  subscribePush: vi.fn(),
}));
const { disableRestAlerts, enableRestAlerts, isDeviceSubscribed, pushAvailability } = vi.hoisted(() => ({
  disableRestAlerts: vi.fn(),
  enableRestAlerts: vi.fn(),
  isDeviceSubscribed: vi.fn(),
  pushAvailability: vi.fn(),
}));

vi.mock("../api/push", () => ({ getPushConfig, subscribePush }));
vi.mock("../lib/push", () => ({
  disableRestAlerts,
  enableRestAlerts,
  isDeviceSubscribed,
  pushAvailability,
}));

import RestAlertSetting from "./RestAlertSetting";

const requestPermission = vi.fn();

function renderSetting() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RestAlertSetting />
    </QueryClientProvider>,
  );
}

function toggle() {
  return screen.getByRole("switch", { name: "Avviso fine riposo" }) as HTMLInputElement;
}

describe("RestAlertSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Notification", { requestPermission });
    getPushConfig.mockResolvedValue({ public_key: "vapid-public-key" });
    pushAvailability.mockReturnValue("available");
    isDeviceSubscribed.mockResolvedValue(false);
    enableRestAlerts.mockResolvedValue("enabled");
    disableRestAlerts.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables the toggle when Web Push is unsupported", async () => {
    pushAvailability.mockReturnValue("unsupported");
    renderSetting();

    expect(await screen.findByText(/schermata Home/i)).toBeInTheDocument();
    expect(screen.getByText(/Per sentirlo in palestra con un Focus attivo.*Impostazioni iOS › Focus/i)).toBeInTheDocument();
    expect(toggle()).toBeDisabled();
  });

  it("disables the toggle when permission is already denied", async () => {
    pushAvailability.mockReturnValue("denied");
    renderSetting();

    expect(await screen.findByText(/riabilitalo in Impostazioni iOS/i)).toBeInTheDocument();
    expect(toggle()).toBeDisabled();
  });

  it("enables and disables rest alerts for the current device", async () => {
    renderSetting();
    const input = await screen.findByRole("switch", { name: "Avviso fine riposo" });

    fireEvent.click(input);
    await waitFor(() => expect(enableRestAlerts).toHaveBeenCalledWith("vapid-public-key"));
    await waitFor(() => expect(toggle()).toBeChecked());

    fireEvent.click(toggle());
    await waitFor(() => expect(disableRestAlerts).toHaveBeenCalledOnce());
    await waitFor(() => expect(toggle()).not.toBeChecked());
  });

  it("shows a permission message and stays off when permission is denied", async () => {
    enableRestAlerts.mockResolvedValue("denied");
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));

    expect(await screen.findByText(/Permesso notifiche negato/i)).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it("disables the toggle when push is not configured on the server", async () => {
    getPushConfig.mockResolvedValue({ public_key: null });
    renderSetting();

    expect(await screen.findByText(/non configurato/i)).toBeInTheDocument();
    expect(toggle()).toBeDisabled();
  });

  it("does not request permission or enable alerts just by rendering", async () => {
    renderSetting();

    await screen.findByRole("switch", { name: "Avviso fine riposo" });
    expect(enableRestAlerts).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
