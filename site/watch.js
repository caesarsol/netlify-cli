/* Syncs blog content from repo to /site/blog */
const path = require('path')
const sane = require('sane')
const fs = require('fs').promises

const config = require('./config')
const { ensureFilePathAsync, removeRecursiveAsync } = require('./fs')

const watcher = sane(config.docs.srcPath, { glob: ['**/*.md'] })

/* Watch Files */
watcher.on('ready', function () {
  console.log(`Watching ${config.docs.srcPath} files for changes`)
})

watcher.on('change', async function (filepath) {
  console.log('file changed', filepath)
  await syncFile(filepath)
})

watcher.on('add', async function (filepath) {
  console.log('file added')
  await syncFile(filepath)
})

watcher.on('delete', async function (filepath) {
  console.log('file deleted', filepath)
  await deleteFile(filepath)
  console.log('File deletion complete')
})

/* utils */
function getFullPath(filePath) {
  return {
    src: path.join(config.docs.srcPath, filePath),
    destination: path.join(config.docs.outputPath, filePath),
  }
}

async function syncFile(filePath) {
  const { src, destination } = getFullPath(filePath)
  await ensureFilePathAsync(destination)
  await fs.copyFile(src, destination)
  console.log(`${filePath} synced to ${destination}`)
}

async function deleteFile(filePath) {
  const { destination } = getFullPath(filePath)
  await removeRecursiveAsync(destination)
  console.log(`${filePath} removed from ${destination}`)
}
