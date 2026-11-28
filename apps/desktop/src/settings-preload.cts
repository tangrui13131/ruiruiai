/** Settings dialog preload: the only renderer surface allowed to persist the API key. */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktopSettings', {
  save: (key: string): Promise<boolean> => ipcRenderer.invoke('settings:save', key),
  cancel: (): Promise<boolean> => ipcRenderer.invoke('settings:cancel'),
  portable: ipcRenderer.sendSync('settings:portable') as boolean,
})
