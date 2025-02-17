import path from 'path'
import { renameSync } from 'fs'
// import { log } from '@/shared/log'
import { startDBServiceWorker as _startDBServiceWorker, workers } from '@any-listen/app/modules/worker'
import { i18n } from '@/app/i18n'
import { appLog } from '@/shared/log4js'

let nativeBindingPath = '../node_modules/better-sqlite3/build/Release/better_sqlite3.node'

// if (import.meta.env.DEV) nativeBindingPath = '../node_modules/better-sqlite3/build/Release/better_sqlite3.node'

const initServices = async (dataPath: string) => {
  let dbFileExists = await workers.dbService.init(dataPath, nativeBindingPath)
  if (dbFileExists === null) {
    const backPath = path.join(dataPath, `anylisten.data.db.${Date.now()}.bak`)
    appLog.warn(i18n.t('database_verify_failed'))
    appLog.warn(i18n.t('database_verify_failed_detail', { backPath }))
    renameSync(path.join(dataPath, 'anylisten.data.db'), backPath)
    dbFileExists = await workers.dbService.init(dataPath, nativeBindingPath)
  }
}

export const startDBServiceWorker = async (dataPath: string) =>
  new Promise<void>((resolve, reject) => {
    void _startDBServiceWorker(() => {
      initServices(dataPath).then(resolve).catch(reject)
    }).catch(reject)
  })
