import { request } from "node:http";
import { stat } from "node:fs/promises";

export type PodmanErrorCode =
  | "SOCKET_MISSING"
  | "SOCKET_UNREACHABLE"
  | "PODMAN_API_ERROR"
  | "PODMAN_TIMEOUT"
  | "CONTAINER_NOT_FOUND"
  | "POD_NOT_FOUND"
  | "LOGS_TOO_LARGE";

export class PodmanError extends Error {
  constructor(
    readonly code: PodmanErrorCode,
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }
}

export interface PodmanResponse {
  status: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

const MAX_BODY = 32 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = "Podman response too large";

export class PodmanClient {
  constructor(
    readonly socketPath: string,
    private readonly timeoutMs: number,
  ) {}

  /** Checks that the socket path exists and is a unix socket. */
  async checkSocket(): Promise<void> {
    try {
      const s = await stat(this.socketPath);
      if (!s.isSocket()) {
        throw new PodmanError("SOCKET_MISSING", `${this.socketPath} is not a socket`);
      }
    } catch (e) {
      if (e instanceof PodmanError) throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new PodmanError("SOCKET_MISSING", `Podman socket not found: ${this.socketPath}`);
      }
      throw new PodmanError("SOCKET_UNREACHABLE", `Cannot access socket (${code ?? "error"})`);
    }
  }

  /** Low-level call. Only invoked with fixed paths built by PodmanService. */
  call(method: "GET" | "POST", path: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<PodmanResponse> {
    const limit = opts.maxBytes ?? MAX_BODY;
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: { Host: "d", Accept: "application/json" },
          timeout: opts.timeoutMs ?? this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > limit) {
              req.destroy(new PodmanError("PODMAN_API_ERROR", TOO_LARGE_MESSAGE));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), headers: res.headers }),
          );
          res.on("error", (e) => reject(mapError(e)));
        },
      );
      req.on("timeout", () =>
        req.destroy(new PodmanError("PODMAN_TIMEOUT", "Podman API timed out")),
      );
      req.on("error", (e) => reject(mapError(e)));
      req.end();
    });
  }
}

function mapError(e: unknown): PodmanError {
  if (e instanceof PodmanError) return e;
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return new PodmanError("SOCKET_MISSING", "Podman socket not found");
  if (code === "ECONNREFUSED" || code === "EACCES" || code === "EPERM") {
    return new PodmanError("SOCKET_UNREACHABLE", `Podman socket unreachable (${code})`);
  }
  return new PodmanError("PODMAN_API_ERROR", `Podman connection error (${code ?? "unknown"})`);
}
