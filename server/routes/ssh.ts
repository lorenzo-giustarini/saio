import { Router } from 'express'
import { listSshKeys, getKnownHosts, VPS_HOSTS } from '../lib/ssh-inventory'

export function sshRouter() {
  const router = Router()

  router.get('/keys', async (_req, res) => {
    const keys = await listSshKeys()
    const knownHostsCount = await getKnownHosts()
    res.json({ keys, count: keys.length, knownHostsCount })
  })

  router.get('/hosts', async (_req, res) => {
    res.json({ hosts: VPS_HOSTS, count: VPS_HOSTS.length })
  })

  return router
}
