export * as ServerDiscovery from "./server-discovery"

import { ServerAuth } from "@/server/auth"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Effect, Option, Schema } from "effect"
import { readFileSync, unlinkSync } from "fs"
import { unlink } from "fs/promises"
import path from "path"

export const file = path.join(Global.Path.state, "server.json")

const Entry = Schema.Struct({
  url: Schema.String,
  pid: Schema.Number,
})
type Entry = typeof Entry.Type
const decodeEntry = Schema.decodeUnknownOption(Entry)

const read = Effect.fn("CliServerDiscovery.read")(function* () {
  const entry = yield* Effect.promise(() => Filesystem.readJson(file).catch(() => undefined))
  return Option.getOrUndefined(decodeEntry(entry))
})

export const write = Effect.fn("CliServerDiscovery.write")(function* (url: URL) {
  yield* Effect.promise(() => Filesystem.writeJson(file, { url: localURL(url).toString(), pid: process.pid }, 0o600))
})

export const remove = Effect.fn("CliServerDiscovery.remove")(function* () {
  const entry = yield* read()
  if (entry?.pid !== process.pid) return
  yield* Effect.promise(() => unlink(file).catch(() => undefined))
})

const removeStale = Effect.fn("CliServerDiscovery.removeStale")(function* (entry: Entry) {
  const current = yield* read()
  if (current?.pid !== entry.pid || current.url !== entry.url) return
  yield* Effect.promise(() => unlink(file).catch(() => undefined))
})

const findEffect = Effect.fn("CliServerDiscovery.find")(function* () {
  const entry = yield* read()
  if (!entry) return undefined
  const url = yield* healthy(entry.url)
  if (url) return url
  yield* removeStale(entry)
})

export const find = () => Effect.runPromise(findEffect())

export function removeSync() {
  const entry = readSync()
  if (entry?.pid !== process.pid) return
  try {
    unlinkSync(file)
  } catch {}
}

function readSync() {
  try {
    return Option.getOrUndefined(decodeEntry(JSON.parse(readFileSync(file, "utf8"))))
  } catch {
    return undefined
  }
}

function healthy(input: string) {
  return Effect.tryPromise({
    try: async () => {
      const url = new URL(input)
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
      const response = await fetch(new URL("/global/health", url), {
        headers: ServerAuth.headers(),
        signal: AbortSignal.timeout(1000),
      })
      if (!response.ok) return undefined
      const body = (await response.json()) as unknown
      if (typeof body === "object" && body !== null && "healthy" in body && body.healthy === true) {
        return url.toString()
      }
    },
    catch: () => undefined,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function localURL(url: URL) {
  const result = new URL(url)
  if (result.hostname === "0.0.0.0") result.hostname = "127.0.0.1"
  if (result.hostname === "::") result.hostname = "::1"
  return result
}
