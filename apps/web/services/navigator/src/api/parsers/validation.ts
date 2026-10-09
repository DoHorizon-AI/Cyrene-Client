import type { JsonRecord } from "../types";
import { NavigatorContractError } from "../errors";

export function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
  }
  return value;
}

export function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${label}.`);
  }
  return value;
}

export function requireString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

export function requireNumber(record: JsonRecord, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

export function readNullableNumber(record: JsonRecord, key: string, label: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

export function requireBoolean(record: JsonRecord, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new NavigatorContractError(`Navigator returned an invalid ${key} in ${label}.`);
  }
  return value;
}

export function readString(record: JsonRecord, key: string, fallback: string): string {
  return typeof record[key] === "string" ? record[key] : fallback;
}

export function readBoolean(record: JsonRecord, key: string, fallback: boolean): boolean {
  return typeof record[key] === "boolean" ? record[key] : fallback;
}

export function readNullableString(record: JsonRecord, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseResourceArray(value: unknown): JsonRecord[] {
  return requireArray(value, "Product resource list").map((item) =>
    requireRecord(item, "Product resource"),
  );
}

export function parseResource(value: unknown): JsonRecord {
  return requireRecord(value, "Product resource");
}
