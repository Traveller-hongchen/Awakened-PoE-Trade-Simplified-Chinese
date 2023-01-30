'use strict'

import { app, dialog } from 'electron'
import { uIOhook } from 'uiohook-napi'
import { startServer, eventPipe, server } from './server'
import { Logger } from './RemoteLogger'
import { GameWindow } from './windowing/GameWindow'
import { OverlayWindow } from './windowing/OverlayWindow'
import { GameConfig } from './host-files/GameConfig'
import { Shortcuts } from './shortcuts/Shortcuts'
import { AppUpdater } from './AppUpdater'
import { AppTray } from './AppTray'
import { OverlayVisibility } from './windowing/OverlayVisibility'
import { GameLogWatcher } from './host-files/GameLogWatcher'
import { HttpProxy } from './proxy'

if (!app.requestSingleInstanceLock()) {
  dialog.showErrorBox(
      '未获取到锁',
      // ----------------------
      '未获取到锁\n' +
      '理论上是你打开了一个其他的进程\n' +
      '但是还在继续查找原因'
  )
  app.exit()
}

app.disableHardwareAcceleration()
app.enableSandbox()

let tray: AppTray

app.on('ready', async () => {
  tray = new AppTray(eventPipe)
  const logger = new Logger(eventPipe)
  const gameLogWatcher = new GameLogWatcher(eventPipe, logger)
  const gameConfig = new GameConfig(eventPipe, logger)
  const poeWindow = new GameWindow()
  const appUpdater = new AppUpdater(eventPipe)
  const httpProxy = new HttpProxy(server)

  setTimeout(
    async () => {
      const overlay = new OverlayWindow(eventPipe, logger, poeWindow, httpProxy)
      new OverlayVisibility(eventPipe, overlay, gameConfig)
      const shortcuts = await Shortcuts.create(logger, overlay, poeWindow, gameConfig, eventPipe)
      eventPipe.onEventAnyClient('CLIENT->MAIN::update-host-config', (cfg) => {
        overlay.updateOpts(cfg.overlayKey, cfg.windowTitle)
        shortcuts.updateActions(cfg.shortcuts, cfg.stashScroll, cfg.restoreClipboard, cfg.language)
        gameLogWatcher.restart(cfg.clientLog)
        gameConfig.readConfig(cfg.gameConfig)
        appUpdater.updateOpts(!cfg.disableUpdateDownload)
        tray.overlayKey = cfg.overlayKey
        httpProxy.updateCookies(cfg.poesessid, cfg.realm)
      })
      uIOhook.start()
      const port = await startServer(appUpdater)
      overlay.loadAppPage(port)
      tray.serverPort = port
    },
    // fixes(linux): window is black instead of transparent
    process.platform === 'linux' ? 1000 : 0
  )
})
