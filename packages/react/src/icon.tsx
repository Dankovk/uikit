import {
  IconProperties as BaseIconProperties,
  PointerEventsProperties,
  Subscriptions,
  createIcon,
  initialize,
  unsubscribeSubscriptions,
} from '@pmndrs/uikit/internals'
import { ReactNode, RefAttributes, forwardRef, useEffect, useMemo, useRef } from 'react'
import { Object3D } from 'three'
import { AddHandlers, usePropertySignals } from './utilts.js'
import { useParent } from './context.js'
import { ComponentInternals, useComponentInternals } from './ref.js'
import type { EventHandlers } from '@react-three/fiber/dist/declarations/src/core/events.js'

export type IconProperties = BaseIconProperties &
  EventHandlers & {
    text: string
    svgWidth: number
    svgHeight: number
    children?: ReactNode
    name?: string
  } & PointerEventsProperties

export const Icon: (
  props: IconProperties & RefAttributes<ComponentInternals<Partial<BaseIconProperties & EventHandlers>>>,
) => ReactNode = forwardRef((properties, ref) => {
  const parent = useParent()
  const outerRef = useRef<Object3D>(null)
  const propertySignals = usePropertySignals(properties)
  const internals = useMemo(
    () =>
      createIcon(
        parent,
        properties.text,
        properties.svgWidth,
        properties.svgHeight,
        propertySignals.style,
        propertySignals.properties,
        propertySignals.default,
        outerRef,
      ),
    [parent, properties.svgHeight, properties.svgWidth, properties.text, propertySignals],
  )

  internals.interactionPanel.name = properties.name ?? ''

  useEffect(() => {
    const subscriptions: Subscriptions = []
    initialize(internals.initializers, subscriptions)
    return () => unsubscribeSubscriptions(subscriptions)
  }, [internals])

  useComponentInternals(ref, parent.root.pixelSize, propertySignals.style, internals, internals.interactionPanel)

  return (
    <AddHandlers properties={properties} ref={outerRef} handlers={internals.handlers}>
      <primitive object={internals.interactionPanel} />
      <primitive object={internals.iconGroup} />
    </AddHandlers>
  )
})
