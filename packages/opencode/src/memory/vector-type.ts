import { customType } from "drizzle-orm/sqlite-core"

export const f32blob = (dim: number) =>
  customType<{ data: Float32Array | null; driverData: Buffer | null }>({
    dataType() {
      return `F32_BLOB(${dim})`
    },
    toDriver(val) {
      if (!val) return null
      return Buffer.from(val.buffer, val.byteOffset, val.byteLength)
    },
    fromDriver(val) {
      if (!val) return null
      return new Float32Array(val.buffer, val.byteOffset, val.byteLength / 4)
    },
  })
