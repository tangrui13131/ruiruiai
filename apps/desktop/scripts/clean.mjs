/** Remove compiled desktop-shell output before a fresh build. */
import { rmSync } from 'node:fs'

rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })
