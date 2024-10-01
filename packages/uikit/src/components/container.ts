import { FlexNode, YogaProperties, createFlexNodeState } from '../flex/node.js'
import { createHoverPropertyTransformers, setupCursorCleanup } from '../hover.js'
import { computedIsClipped, computedClippingRect } from '../clipping.js'
import {
  ScrollbarProperties,
  applyScrollPosition,
  computedAnyAncestorScrollable,
  computedGlobalScrollMatrix,
  computedScrollHandlers,
  createScrollPosition,
  createScrollbars,
} from '../scroll.js'
import { WithAllAliases } from '../properties/alias.js'
import { PanelProperties, createInstancedPanel } from '../panel/instanced-panel.js'
import { TransformProperties, applyTransform, computedTransformMatrix } from '../transform.js'
import { AllOptionalProperties, WithClasses, WithReactive } from '../properties/default.js'
import { createResponsivePropertyTransformers } from '../responsive.js'
import { ElementType, ZIndexProperties, computedOrderInfo } from '../order.js'
import { createActivePropertyTransfomers } from '../active.js'
import { Signal, signal } from '@preact/signals-core'
import {
  VisibilityProperties,
  WithConditionals,
  computedGlobalMatrix,
  computedHandlers,
  computedIsVisible,
  computedMergedProperties,
  createNode,
} from './utils.js'
import { Listeners, setupLayoutListeners, setupClippedListeners } from '../listeners.js'
import { Object3DRef, ParentContext } from '../context.js'
import { PanelGroupProperties, computedPanelGroupDependencies } from '../panel/instanced-panel-group.js'
import { createInteractionPanel } from '../panel/instanced-panel-mesh.js'
import { Initializers } from '../utils.js'
import { darkPropertyTransformers } from '../dark.js'
import { getDefaultPanelMaterialConfig } from '../panel/index.js'
import { computedInheritableProperty } from '../internals.js'

export type InheritableContainerProperties = WithClasses<
  WithConditionals<
    WithAllAliases<
      WithReactive<
        YogaProperties &
          PanelProperties &
          ZIndexProperties &
          TransformProperties &
          ScrollbarProperties &
          PanelGroupProperties &
          VisibilityProperties
      >
    >
  >
>

export type ContainerProperties = InheritableContainerProperties & Listeners

export function createContainer(
  parentContext: ParentContext,
  style: Signal<ContainerProperties | undefined>,
  properties: Signal<ContainerProperties | undefined>,
  defaultProperties: Signal<AllOptionalProperties | undefined>,
  object: Object3DRef,
  childrenContainer: Object3DRef,
) {
  const node = signal<FlexNode | undefined>(undefined)
  const flexState = createFlexNodeState()
  const hoveredSignal = signal<Array<number>>([])
  const activeSignal = signal<Array<number>>([])
  const initializers: Initializers = []

  setupCursorCleanup(hoveredSignal, initializers)

  //properties
  const mergedProperties = computedMergedProperties(style, properties, defaultProperties, {
    ...darkPropertyTransformers,
    ...createResponsivePropertyTransformers(parentContext.root.size),
    ...createHoverPropertyTransformers(hoveredSignal),
    ...createActivePropertyTransfomers(activeSignal),
  })

  //create node
  createNode(node, flexState, parentContext, mergedProperties, object, false, initializers)

  //transform
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

  //instanced panel
  const groupDeps = computedPanelGroupDependencies(mergedProperties)
  const orderInfo = computedOrderInfo(mergedProperties, ElementType.Panel, groupDeps, parentContext.orderInfo)
  initializers.push((subscriptions) =>
    createInstancedPanel(
      mergedProperties,
      orderInfo,
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

  //scrolling:
  const scrollPosition = createScrollPosition()
  applyScrollPosition(childrenContainer, scrollPosition, parentContext.root.pixelSize, initializers)
  const childrenMatrix = computedGlobalScrollMatrix(scrollPosition, globalMatrix, parentContext.root.pixelSize)
  const scrollbarWidth = computedInheritableProperty(mergedProperties, 'scrollbarWidth', 10)
  createScrollbars(
    mergedProperties,
    scrollPosition,
    flexState,
    globalMatrix,
    isVisible,
    parentContext.clippingRect,
    orderInfo,
    parentContext.root.panelGroupManager,
    scrollbarWidth,
    initializers,
  )
  const interactionPanel = createInteractionPanel(
    orderInfo,
    parentContext.root,
    parentContext.clippingRect,
    flexState.size,
    initializers,
  )
  const scrollHandlers = computedScrollHandlers(
    scrollPosition,
    parentContext.anyAncestorScrollable,
    flexState,
    object,
    scrollbarWidth,
    properties,
    parentContext.root,
    initializers,
  )

  setupLayoutListeners(style, properties, flexState.size, initializers)
  setupClippedListeners(style, properties, isClipped, initializers)

  return Object.assign(flexState, {
    isClipped,
    isVisible,
    mergedProperties,
    anyAncestorScrollable: computedAnyAncestorScrollable(flexState.scrollable, parentContext.anyAncestorScrollable),
    clippingRect: computedClippingRect(
      globalMatrix,
      flexState,
      parentContext.root.pixelSize,
      parentContext.clippingRect,
    ),
    childrenMatrix,
    node,
    orderInfo,
    root: parentContext.root,
    scrollPosition,
    interactionPanel,
    handlers: computedHandlers(style, properties, defaultProperties, hoveredSignal, activeSignal, scrollHandlers),
    initializers,
  })
}
