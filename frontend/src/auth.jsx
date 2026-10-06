import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, session } from './lib.js'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const refreshUser = useCallback(async () => {
    try { setUser(await api('/auth/me')) } catch { setUser(null) }
  }, [])
  useEffect(() => { (session.get() ? refreshUser() : Promise.resolve()).finally(() => setReady(true)) }, [refreshUser])
  useEffect(() => {
    const h = () => { session.clear(); setUser(null) }
    window.addEventListener('aegis:logout', h)
    return () => window.removeEventListener('aegis:logout', h)
  }, [])
  const signIn = (res) => { session.set({ access_token: res.access_token, refresh_token: res.refresh_token }); setUser(res.user) }
  const signOut = () => { session.clear(); setUser(null) }
  return <Ctx.Provider value={{ user, ready, signIn, signOut, refreshUser }}>{children}</Ctx.Provider>
}
