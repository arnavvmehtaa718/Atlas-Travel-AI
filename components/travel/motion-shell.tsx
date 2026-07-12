'use client'

import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export function MotionShell({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reduceMotion || !root.current) return
    gsap.registerPlugin(ScrollTrigger)
    const context = gsap.context(() => {
      gsap.fromTo('.hero-motion-line', { yPercent: 110, rotate: 2 }, { yPercent: 0, rotate: 0, duration: 1.05, stagger: 0.1, ease: 'power4.out' })
      gsap.to('.hero-aside', { y: 70, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
      gsap.utils.toArray<HTMLElement>('.motion-reveal').forEach((element) => {
        gsap.fromTo(element, { autoAlpha: 0, y: 54 }, { autoAlpha: 1, y: 0, duration: .85, ease: 'power3.out', scrollTrigger: { trigger: element, start: 'top 88%', once: true } })
      })
      gsap.utils.toArray<HTMLElement>('.day').forEach((day) => {
        gsap.fromTo(day, { autoAlpha: 0, x: -28 }, { autoAlpha: 1, x: 0, duration: .75, ease: 'power3.out', scrollTrigger: { trigger: day, start: 'top 84%', once: true } })
      })
      const routeProgress = root.current?.querySelector('.route-progress')
      const timeline = root.current?.querySelector('.timeline')
      if (routeProgress && timeline) gsap.to(routeProgress, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: timeline, start: 'top 68%', end: 'bottom 70%', scrub: true } })
      const postcardInner = root.current?.querySelector('.postcard-inner')
      const postcard = root.current?.querySelector('.postcard')
      if (postcardInner && postcard) gsap.to(postcardInner, { y: -55, ease: 'none', scrollTrigger: { trigger: postcard, start: 'top bottom', end: 'bottom top', scrub: true } })
    }, root)
    return () => context.revert()
  }, [reduceMotion, children])

  return <motion.div ref={root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduceMotion ? 0 : .45 }}>{children}</motion.div>
}

export const MotionButton = motion.button
export const MotionArticle = motion.article
