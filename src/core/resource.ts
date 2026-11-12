import type { HttpClient } from "./http.ts";

export abstract class APIResource {
  protected readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }
}

/** Encodes one path segment (concept names may contain `/`, spaces, etc.). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}
