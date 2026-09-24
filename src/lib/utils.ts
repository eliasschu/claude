import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Klassennamen zusammenfuehren, spaetere Angaben gewinnen. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
