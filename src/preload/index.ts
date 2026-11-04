import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ChatEvent } from '@shared/types'

const inv = (ch: string) => (...a: unknown[]) => ipcRenderer.invoke(ch, ...a)
function on<T extends unknown[]>(ch: string, cb: (...a: T) => void) {
  const l = (_e: unknown, ...a: unknown[]) => cb(...(a as T))
  ipcRenderer.on(ch, l)
  return () => {
    ipcRenderer.removeListener(ch, l)
  }
}

const api: Api = {
  getState: inv('state:get') as Api['getState'],
  pickAndAddRepo: inv('repo:pick') as Api['pickAndAddRepo'],
  addRepo: inv('repo:add') as Api['addRepo'],
  removeRepo: inv('repo:remove') as Api['removeRepo'],
  setRepoHidden: inv('repo:hidden') as Api['setRepoHidden'],
  createWorkspace: inv('ws:create') as Api['createWorkspace'],
  archiveWorkspace: inv('ws:archive') as Api['archiveWorkspace'],
  renameWorkspace: inv('ws:rename') as Api['renameWorkspace'],
  createChat: inv('chat:create') as Api['createChat'],
  closeChat: inv('chat:close') as Api['closeChat'],
  getChatItems: inv('chat:items') as Api['getChatItems'],
  updateChat: inv('chat:update') as Api['updateChat'],
  sendMessage: inv('chat:send') as Api['sendMessage'],
  stopChat: inv('chat:stop') as Api['stopChat'],
  addChatFolder: inv('chat:addFolder') as Api['addChatFolder'],
  removeChatFolder: inv('chat:removeFolder') as Api['removeChatFolder'],
  listFiles: inv('ws:files') as Api['listFiles'],
  listCommands: inv('ws:commands') as Api['listCommands'],
  getScripts: inv('scripts:get') as Api['getScripts'],
  runScript: inv('scripts:run') as Api['runScript'],
  stopScript: (id, kind) => ipcRenderer.send('scripts:stop', id, kind),
  isScriptRunning: inv('scripts:running') as Api['isScriptRunning'],
  getPr: inv('pr:get') as Api['getPr'],
  mergePr: inv('pr:merge') as Api['mergePr'],
  getChecks: inv('checks:get') as Api['getChecks'],
  rerunCheck: inv('checks:rerun') as Api['rerunCheck'],
  getArtifacts: inv('ws:artifacts') as Api['getArtifacts'],
  readFile: inv('ws:readFile') as Api['readFile'],
  revertTo: inv('chat:revert') as Api['revertTo'],
  saveSettings: inv('settings:save') as Api['saveSettings'],
  cloneRepo: inv('repo:clone') as Api['cloneRepo'],
  onNavigate: (cb) => on<[string, string]>('navigate', cb),
  onChatEvent: (cb) => on<[ChatEvent]>('chat:event', cb),
  getChanges: inv('git:changes') as Api['getChanges'],
  getDiffStats: inv('git:stats') as Api['getDiffStats'],
  getFileDiff: inv('git:fileDiff') as Api['getFileDiff'],
  ptyCreate: inv('pty:create') as Api['ptyCreate'],
  ptyAttach: inv('pty:attach') as Api['ptyAttach'],
  onScriptStarted: (cb) => on<[string, 'setup' | 'run']>('script:started', cb),
  ptyWrite: (id, d) => ipcRenderer.send('pty:write', id, d),
  ptyResize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => on<[string, string]>('pty:data', cb),
  onPtyExit: (cb) => on<[string, number]>('pty:exit', cb),
  openExternal: inv('shell:open') as Api['openExternal'],
  revealInFinder: inv('shell:reveal') as Api['revealInFinder'],
  onMenu: (cb) => on<[string]>('menu', cb),
  onStateChanged: (cb) => on<[]>('state:changed', cb)
}

contextBridge.exposeInMainWorld('api', api)
