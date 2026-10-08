'use client'
import { useEffect, useRef } from 'react'

export function useIgnoredEffect(
  effect: () => void | (() => void),
  triggerDeps: any[],
  ignoredDeps: any[],
) {
  const ignoredDepsRef = useRef(ignoredDeps)

  useEffect(() => {
    ignoredDepsRef.current = ignoredDeps
  }, ignoredDeps)

  useEffect(effect, triggerDeps)
}
