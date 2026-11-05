import { useStoredString } from "@/components/use-stored-string";

/** The host's choice is kept in this browser (`use-stored-string.ts`) and applies to every campaign it hosts later. */
const AUTO_NEXT_KEY = "crush.net.autonext";

/** Whether a hosted campaign moves on by itself after its between-rounds minute: saved in this browser, on until the host switches it off. */
export function useAutoNext(): [boolean, (on: boolean) => void] {
  const [value, setValue] = useStoredString(AUTO_NEXT_KEY, "on", "on");
  return [value !== "off", (on) => setValue(on ? "on" : "off")];
}
