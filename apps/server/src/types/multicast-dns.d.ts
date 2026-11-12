declare module 'multicast-dns' {
  type Mdns = {
    on(event: string, handler: (...args: never[]) => void): void;
    query(q: unknown): void;
    respond(r: unknown): void;
    destroy(): void;
  };
  export default function multicastDns(opts?: unknown): Mdns;
}
