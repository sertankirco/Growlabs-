// Minimal Node.js ambient declarations — @types/node yokken TypeScript derleyicisini tatmin eder.

// ── Global ────────────────────────────────────────────────────────────────────

declare const __dirname: string;
declare const __filename: string;
declare const require: { (id: string): any; main: NodeModule | undefined };
interface NodeModule { filename: string; }

declare namespace NodeJS {
  // Node.js'te Timeout ve Interval aynı sınıftır (unref() vs ref() desteğiyle)
  interface Timeout {
    unref(): this;
    ref(): this;
    hasRef(): boolean;
    refresh(): this;
    readonly [Symbol.toPrimitive]: () => number;
  }
  type Interval = Timeout;
  interface TypedArray extends Uint8Array {}
  interface ProcessEnv { [key: string]: string | undefined; }
  interface Process {
    env:         ProcessEnv;
    memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number };
    uptime():    number;
    exit(code?: number): never;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }
  interface EventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
  }
}

declare const process: NodeJS.Process;
declare function setTimeout(fn: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearTimeout(id?: NodeJS.Timeout | number): void;
declare function setInterval(fn: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearInterval(id?: NodeJS.Timeout | number): void;

type BufferEncoding =
  | 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2'
  | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';

declare class Buffer extends Uint8Array {
  static from(data: string, encoding?: BufferEncoding): Buffer;
  static from(data: ArrayBuffer | SharedArrayBuffer): Buffer;
  static from(data: Uint8Array | Buffer | number[]): Buffer;
  static alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
  static allocUnsafe(size: number): Buffer;
  static concat(list: ReadonlyArray<Uint8Array | Buffer>, totalLength?: number): Buffer;
  static byteLength(string: string, encoding?: BufferEncoding): number;
  static isBuffer(obj: unknown): obj is Buffer;
  // toString overloads
  toString(encoding?: BufferEncoding): string;
  toString(encoding: BufferEncoding, start: number, end?: number): string;
  // write overloads
  write(str: string, encoding?: BufferEncoding): number;
  write(str: string, offset: number, encoding?: BufferEncoding): number;
  write(str: string, offset: number, length: number, encoding?: BufferEncoding): number;
  // integer readers/writers
  readInt8(offset?: number): number;
  readUInt8(offset?: number): number;
  readInt16BE(offset?: number): number;
  readUInt16BE(offset?: number): number;
  readInt32BE(offset?: number): number;
  readUInt32BE(offset?: number): number;
  readBigInt64BE(offset?: number): bigint;
  readBigUInt64BE(offset?: number): bigint;
  writeInt8(value: number, offset?: number): number;
  writeUInt8(value: number, offset?: number): number;
  writeInt16BE(value: number, offset?: number): number;
  writeUInt16BE(value: number, offset?: number): number;
  writeInt32BE(value: number, offset?: number): number;
  writeUInt32BE(value: number, offset?: number): number;
  writeBigInt64BE(value: bigint, offset?: number): number;
  writeBigUInt64BE(value: bigint, offset?: number): number;
  // array methods — return Buffer instead of Uint8Array
  slice(start?: number, end?: number): Buffer;
  subarray(start?: number, end?: number): Buffer;
  indexOf(value: number | string | Buffer, byteOffset?: number, encoding?: BufferEncoding): number;
  copy(target: Buffer, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
}

// ── events ────────────────────────────────────────────────────────────────────

declare module 'events' {
  class EventEmitter implements NodeJS.EventEmitter {
    static defaultMaxListeners: number;
    addListener(event: string | symbol, listener: (...args: any[]) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
    listeners(event: string | symbol): Function[];
    rawListeners(event: string | symbol): Function[];
    emit(event: string | symbol, ...args: any[]): boolean;
    listenerCount(event: string | symbol): number;
    prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
    prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
    eventNames(): (string | symbol)[];
  }
  export { EventEmitter };
  export default EventEmitter;
}

// ── crypto ────────────────────────────────────────────────────────────────────

declare module 'crypto' {
  interface Hmac {
    update(data: string | Buffer | NodeJS.TypedArray): this;
    digest(encoding: 'hex' | 'base64' | 'base64url'): string;
    digest(): Buffer;
  }
  interface Hash {
    update(data: string | Buffer): this;
    digest(encoding: 'hex' | 'base64'): string;
    digest(): Buffer;
  }
  function createHmac(algorithm: string, key: string | Buffer): Hmac;
  function createHash(algorithm: string): Hash;
  function randomUUID(): string;
  function timingSafeEqual(a: Buffer | NodeJS.TypedArray, b: Buffer | NodeJS.TypedArray): boolean;
  function randomBytes(size: number): Buffer;
}

// ── url ───────────────────────────────────────────────────────────────────────

declare module 'url' {
  class URL {
    constructor(input: string, base?: string | URL);
    href:         string;
    protocol:     string;
    username:     string;
    password:     string;
    host:         string;
    hostname:     string;
    port:         string;
    pathname:     string;
    search:       string;
    searchParams: URLSearchParams;
    hash:         string;
    toString(): string;
  }
  export { URL };
}

// ── net ───────────────────────────────────────────────────────────────────────

declare module 'net' {
  interface Socket extends NodeJS.EventEmitter {
    write(data: string | Buffer, cb?: (err?: Error) => void): boolean;
    end(data?: string | Buffer): void;
    destroy(err?: Error): void;
    setTimeout(ms: number, cb?: () => void): this;
    setNoDelay(noDelay?: boolean): this;
    setKeepAlive(enable?: boolean, delay?: number): this;
    connecting: boolean;
    destroyed:  boolean;
    writable:   boolean;
    readable:   boolean;
    remoteAddress?: string;
    remotePort?:    number;
  }
  function createConnection(options: { host: string; port: number }, cb?: () => void): Socket;
  function createConnection(port: number, host?: string, cb?: () => void): Socket;
  function connect(options: { host: string; port: number }, cb?: () => void): Socket;
  function connect(port: number, host?: string, cb?: () => void): Socket;
  export { Socket, createConnection, connect };
}

// ── http / https ──────────────────────────────────────────────────────────────

declare module 'http' {
  interface IncomingMessage extends NodeJS.EventEmitter {
    statusCode?:   number;
    statusMessage?: string;
    headers:       Record<string, string | string[] | undefined>;
    method?:       string;
    url?:          string;
    socket:        any;
    setEncoding(enc: BufferEncoding): this;
    resume(): this;
  }
  interface ServerResponse extends NodeJS.EventEmitter {
    statusCode:  number;
    headersSent: boolean;
    setHeader(name: string, value: string | number | readonly string[]): this;
    writeHead(code: number, headers?: Record<string, string | number | string[]>): this;
    end(data?: string | Buffer): void;
    write(data: string | Buffer): boolean;
  }
  interface ClientRequest extends NodeJS.EventEmitter {
    setTimeout(ms: number, cb?: () => void): this;
    end(): void;
    destroy(err?: Error): void;
  }
  interface RequestOptions {
    hostname?: string;
    host?:     string;
    port?:     string | number;
    path?:     string;
    method?:   string;
    headers?:  Record<string, string | string[]>;
  }
  interface Server extends NodeJS.EventEmitter {
    listen(port: number, cb?: () => void): this;
    listen(options: { port?: number }, cb?: () => void): this;
    close(cb?: (err?: Error) => void): this;
  }
  function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
  function request(opts: RequestOptions | string, cb?: (res: IncomingMessage) => void): ClientRequest;
  export {
    IncomingMessage, ServerResponse, ClientRequest, RequestOptions, Server,
    createServer, request,
  };
}

declare module 'https' {
  import { RequestOptions, ClientRequest, IncomingMessage } from 'http';
  function request(opts: RequestOptions | string, cb?: (res: IncomingMessage) => void): ClientRequest;
  export { request, RequestOptions };
}

// ── fs ────────────────────────────────────────────────────────────────────────

declare module 'fs' {
  function readFileSync(path: string, encoding: 'utf8' | 'utf-8'): string;
  function readFileSync(path: string): Buffer;
  function existsSync(path: string): boolean;
  function writeFileSync(path: string, data: string | Buffer, options?: { encoding?: BufferEncoding }): void;
  export { readFileSync, existsSync, writeFileSync };
}

// ── path ──────────────────────────────────────────────────────────────────────

// ── node:test ─────────────────────────────────────────────────────────────────

declare module 'node:test' {
  interface TestContext {
    diagnostic(message: string): void;
    skip(message?: string): void;
    todo(message?: string): void;
    mock: { fn<T extends (...args: any[]) => any>(fn?: T): T & { mock: { calls: any[] } } };
  }
  type DoneCallback = (err?: Error | null) => void;
  type TestFn = (t: TestContext) => void | Promise<void>;
  type TestFnWithDone = (t: TestContext, done: DoneCallback) => void;

  interface SuiteOptions { skip?: boolean | string; timeout?: number; concurrency?: number; }
  interface TestOptions { skip?: boolean | string; timeout?: number; }

  function describe(name: string, fn?: () => void): void;
  function describe(name: string, options: SuiteOptions, fn: () => void): void;
  function it(name: string, fn?: TestFn | TestFnWithDone): void;
  function it(name: string, options: TestOptions, fn: TestFn | TestFnWithDone): void;
  function before(fn: TestFn): void;
  function beforeEach(fn: TestFn): void;
  function after(fn: TestFn): void;
  function afterEach(fn: TestFn): void;
  export { describe, it, before, beforeEach, after, afterEach, TestContext };
}

declare module 'node:assert' {
  function assert(value: unknown, message?: string | Error): asserts value;
  namespace assert {
    function ok(value: unknown, message?: string | Error): asserts value;
    function equal(actual: any, expected: any, message?: string | Error): void;
    function notEqual(actual: any, expected: any, message?: string | Error): void;
    function deepEqual(actual: any, expected: any, message?: string | Error): void;
    function notDeepEqual(actual: any, expected: any, message?: string | Error): void;
    function strictEqual(actual: any, expected: any, message?: string | Error): void;
    function notStrictEqual(actual: any, expected: any, message?: string | Error): void;
    function deepStrictEqual(actual: any, expected: any, message?: string | Error): void;
    function notDeepStrictEqual(actual: any, expected: any, message?: string | Error): void;
    function throws(fn: () => unknown, expected?: any, message?: string | Error): void;
    function doesNotThrow(fn: () => unknown, message?: string | Error): void;
    function rejects(fn: () => Promise<unknown>, expected?: any, message?: string | Error): Promise<void>;
    function doesNotReject(fn: () => Promise<unknown>, message?: string | Error): Promise<void>;
    function fail(message?: string | Error): never;
    function match(value: string, regExp: RegExp, message?: string | Error): void;
    function doesNotMatch(value: string, regExp: RegExp, message?: string | Error): void;
    class AssertionError extends Error {
      actual: any;
      expected: any;
      operator: string;
    }
  }
  export = assert;
}

declare module 'node:assert/strict' {
  import assert = require('node:assert');
  export = assert;
}

// ── path ──────────────────────────────────────────────────────────────────────

declare module 'path' {
  function join(...parts: string[]): string;
  function resolve(...parts: string[]): string;
  function dirname(p: string): string;
  function basename(p: string, ext?: string): string;
  function extname(p: string): string;
  export { join, resolve, dirname, basename, extname };
}
