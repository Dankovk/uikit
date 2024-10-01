import { FlexNode, YogaProperties, createFlexNodeState } from '../flex/node.js'
import { createHoverPropertyTransformers, setupCursorCleanup } from '../hover.js'
import { computedIsClipped } from '../clipping.js'
import { ScrollbarProperties } from '../scroll.js'
import { WithAllAliases } from '../properties/alias.js'
import { PanelProperties, createInstancedPanel } from '../panel/instanced-panel.js'
import { TransformProperties, applyTransform, computedTransformMatrix } from '../transform.js'
import { AllOptionalProperties, WithClasses, WithReactive } from '../properties/default.js'
import { createResponsivePropertyTransformers } from '../responsive.js'
import { ElementType, ZIndexProperties, computedOrderInfo } from '../order.js'
import { createActivePropertyTransfomers } from '../active.js'
import { Signal, effect, signal } from '@preact/signals-core'
import {
  VisibilityProperties,
  WithConditionals,
  computedGlobalMatrix,
  computedHandlers,
  computedIsVisible,
  computedMergedProperties,
  createNode,
} from './utils.js'
import { Initializers } from '../utils.js'
import { Listeners, setupLayoutListeners, setupClippedListeners } from '../listeners.js'
import { Object3DRef, ParentContext } from '../context.js'
import { PanelGroupProperties, computedPanelGroupDependencies } from '../panel/instanced-panel-group.js'
import { createInteractionPanel, getDefaultPanelMaterialConfig } from '../panel/index.js'
import {
  FontFamilies,
  InstancedTextProperties,
  computedFont,
  computedGylphGroupDependencies,
  createInstancedText,
} from '../text/index.js'
import { darkPropertyTransformers } from '../dark.js'

export type InheritableTextProperties = WithClasses<
  WithConditionals<
    WithAllAliases<
      WithReactive<
        YogaProperties &
          PanelProperties &
          ZIndexProperties &
          TransformProperties &
          ScrollbarProperties &
          PanelGroupProperties &
          InstancedTextProperties &
          VisibilityProperties
      >
    >
  >
>

export type TextProperties = InheritableTextProperties & Listeners

export function createText(
  parentContext: ParentContext,
  textSignal: Signal<string | Signal<string> | Array<string | Signal<string>>>,
  fontFamilies: Signal<FontFamilies | undefined> | undefined,
  style: Signal<TextProperties | undefined>,
  properties: Signal<TextProperties | undefined>,
  defaultProperties: Signal<AllOptionalProperties | undefined>,
  object: Object3DRef,
) {
  const hoveredSignal = signal<Array<number>>([])
  const activeSignal = signal<Array<number>>([])
  const initializers: Initializers = []
  setupCursorCleanup(hoveredSignal, initializers)

  const mergedProperties = computedMergedProperties(style, properties, defaultProperties, {
    ...darkPropertyTransformers,
    ...createResponsivePropertyTransformers(parentContext.root.size),
    ...createHoverPropertyTransformers(hoveredSignal),
    ...createActivePropertyTransfomers(activeSignal),
  })

  const nodeSignal = signal<FlexNode | undefined>(undefined)
  const flexState = createFlexNodeState()
  createNode(nodeSignal, flexState, parentContext, mergedProperties, object, false, initializers)

  const transformMatrix = computedTransformMatrix(mergedProperties, flexState, parentContext.root.pixelSize)
  applyTransform(parentContext.root, object, transformMatrix, initializers)

  const globalMatrix = computedGlobalMatrix(parentContext.childrenMatrix, transformMatrix)

  const isClipped = computedIsClipped(
    parentContext.clippingRect,
    globalMatrix,
    flexState.size,
    parentContext.root.pixelSize,
  )
  const isVisible = computedIsVisible(flexState, isClipped, mergedProperties)

  const groupDeps = computedPanelGroupDependencies(mergedProperties)
  const backgroundOrderInfo = computedOrderInfo(mergedProperties, ElementType.Panel, groupDeps, parentContext.orderInfo)
  initializers.push((subscriptions) =>
    createInstancedPanel(
      mergedProperties,
      backgroundOrderInfo,
      groupDeps,
      parentContext.root.panelGroupManager,
      globalMatrix,
      flexState.size,
      undefined,
      flexState.borderInset,
      parentContext.clippingRect,
      isVisible,
      getDefaultPanelMaterialConfig(),
      subscriptions,
    ),
  )

  const fontSignal = computedFont(mergedProperties, fontFamilies, parentContext.root.renderer, initializers)
  const orderInfo = computedOrderInfo(
    undefined,
    ElementType.Text,
    computedGylphGroupDependencies(fontSignal),
    backgroundOrderInfo,
  )

  const customLayouting = createInstancedText(
    mergedProperties,
    textSignal,
    globalMatrix,
    nodeSignal,
    flexState,
    isVisible,
    parentContext.clippingRect,
    orderInfo,
    fontSignal,
    parentContext.root.gylphGroupManager,
    undefined,
    undefined,
    undefined,
    undefined,
    initializers,
    'break-word',
  )
  initializers.push(() => effect(() => nodeSignal.value?.setCustomLayouting(customLayouting.value)))

  setupLayoutListeners(style, properties, flexState.size, initializers)
  setupClippedListeners(style, properties, isClipped, initializers)

  return Object.assign(flexState, {
    isClipped,
    isVisible,
    mergedProperties,
    interactionPanel: createInteractionPanel(
      backgroundOrderInfo,
      parentContext.root,
      parentContext.clippingRect,
      flexState.size,
      initializers,
    ),
    handlers: computedHandlers(style, properties, defaultProperties, hoveredSignal, activeSignal),
    initializers,
  })
}
