import { FlexNodeState, YogaProperties, createFlexNodeState } from '../flex/node.js'
import { createHoverPropertyTransformers, setupCursorCleanup } from '../hover.js'
import { computedIsClipped, createGlobalClippingPlanes, ClippingRect } from '../clipping.js'
import { ScrollbarProperties } from '../scroll.js'
import { WithAllAliases } from '../properties/alias.js'
import { PanelProperties, createInstancedPanel } from '../panel/instanced-panel.js'
import { TransformProperties, applyTransform, computedTransformMatrix } from '../transform.js'
import { AllOptionalProperties, WithClasses, WithReactive } from '../properties/default.js'
import { createResponsivePropertyTransformers } from '../responsive.js'
import { ElementType, OrderInfo, ZIndexProperties, computedOrderInfo, setupRenderOrder } from '../order.js'
import { createActivePropertyTransfomers } from '../active.js'
import { Signal, computed, effect, signal } from '@preact/signals-core'
import {
  VisibilityProperties,
  WithConditionals,
  computedGlobalMatrix,
  computedHandlers,
  computedIsVisible,
  computedMergedProperties,
  createNode,
  keepAspectRatioPropertyTransformer,
} from './utils.js'
import { Initializers, alignmentZMap } from '../utils.js'
import { Listeners, setupLayoutListeners, setupClippedListeners } from '../listeners.js'
import { Object3DRef, ParentContext, RootContext } from '../context.js'
import { PanelGroupProperties, computedPanelGroupDependencies } from '../panel/instanced-panel-group.js'
import { createInteractionPanel } from '../panel/instanced-panel-mesh.js'
import { Box3, Material, Mesh, Object3D, Vector3 } from 'three'
import { darkPropertyTransformers } from '../dark.js'
import { getDefaultPanelMaterialConfig, makeClippedCast } from '../panel/index.js'
import { MergedProperties, computedInheritableProperty } from '../properties/index.js'
import { KeepAspectRatioProperties } from './image.js'

export type InheritableContentProperties = WithClasses<
  WithConditionals<
    WithAllAliases<
      WithReactive<
        YogaProperties &
          PanelProperties &
          ZIndexProperties &
          TransformProperties &
          ScrollbarProperties &
          PanelGroupProperties &
          DepthAlignProperties &
          KeepAspectRatioProperties &
          VisibilityProperties
      >
    >
  >
>

export type DepthAlignProperties = {
  depthAlign?: keyof typeof alignmentZMap
}

export type ContentProperties = InheritableContentProperties & Listeners

export function createContent(
  parentContext: ParentContext,
  style: Signal<ContentProperties | undefined>,
  properties: Signal<ContentProperties | undefined>,
  defaultProperties: Signal<AllOptionalProperties | undefined>,
  object: Object3DRef,
  contentContainerRef: Object3DRef,
) {
  const hoveredSignal = signal<Array<number>>([])
  const activeSignal = signal<Array<number>>([])
  const initializers: Initializers = []
  const flexState = createFlexNodeState()

  setupCursorCleanup(hoveredSignal, initializers)

  const sizeSignal = signal(new Vector3(1, 1, 1))
  const aspectRatio = computed(() => sizeSignal.value.x / sizeSignal.value.y)

  //properties
  const mergedProperties = computedMergedProperties(
    style,
    properties,
    defaultProperties,
    {
      ...darkPropertyTransformers,
      ...createResponsivePropertyTransformers(parentContext.root.size),
      ...createHoverPropertyTransformers(hoveredSignal),
      ...createActivePropertyTransfomers(activeSignal),
    },
    keepAspectRatioPropertyTransformer,
    (m) => m.add('aspectRatio', aspectRatio),
  )

  //create node
  createNode(undefined, flexState, parentContext, mergedProperties, object, true, initializers)

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
  const backgroundorderInfo = computedOrderInfo(mergedProperties, ElementType.Panel, groupDeps, parentContext.orderInfo)
  initializers.push((subscriptions) =>
    createInstancedPanel(
      mergedProperties,
      backgroundorderInfo,
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

  const orderInfo = computedOrderInfo(undefined, ElementType.Object, undefined, backgroundorderInfo)

  setupLayoutListeners(style, properties, flexState.size, initializers)
  setupClippedListeners(style, properties, isClipped, initializers)

  return Object.assign(flexState, {
    isClipped,
    isVisible,
    mergedProperties,
    remeasureContent: createMeasureContent(
      mergedProperties,
      parentContext.root,
      flexState,
      parentContext.clippingRect,
      isVisible,
      orderInfo,
      sizeSignal,
      contentContainerRef,
      initializers,
    ),
    interactionPanel: createInteractionPanel(
      backgroundorderInfo,
      parentContext.root,
      parentContext.clippingRect,
      flexState.size,
      initializers,
    ),
    handlers: computedHandlers(style, properties, defaultProperties, hoveredSignal, activeSignal),
    initializers,
  })
}

const box3Helper = new Box3()
const smallValue = new Vector3().setScalar(0.001)
const vectorHelper = new Vector3()

const defaultDepthAlign: keyof typeof alignmentZMap = 'back'

/**
 * normalizes the content so it has a height of 1
 */
function createMeasureContent(
  propertiesSignal: Signal<MergedProperties>,
  root: RootContext,
  flexState: FlexNodeState,
  parentClippingRect: Signal<ClippingRect | undefined>,
  isVisible: Signal<boolean>,
  orderInfo: Signal<OrderInfo | undefined>,
  sizeSignal: Signal<Vector3>,
  contentContainerRef: Object3DRef,
  initializers: Initializers,
) {
  const clippingPlanes = createGlobalClippingPlanes(root, parentClippingRect)
  const depthAlign = computedInheritableProperty(propertiesSignal, 'depthAlign', defaultDepthAlign)
  const keepAspectRatio = computedInheritableProperty(propertiesSignal, 'keepAspectRatio', true)
  const measuredSize = new Vector3()
  const measuredCenter = new Vector3()
  const updateRenderProperties = (
    content: Object3D | null,
    visible: boolean,
    renderOrder: number,
    depthTest: boolean,
  ) => {
    if (content == null) {
      return
    }
    content.visible = visible
    content.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return
      }
      object.renderOrder = renderOrder
      if (!(object.material instanceof Material)) {
        return
      }
      object.material.depthTest = depthTest
    })
    root.requestRender()
  }
  const measureContent = () => {
    const content = contentContainerRef.current
    if (content == null) {
      measuredSize.copy(smallValue)
      measuredCenter.set(0, 0, 0)
      return
    }
    content.traverse((object) => {
      if (object instanceof Mesh) {
        setupRenderOrder(object, root, orderInfo)
        object.material.clippingPlanes = clippingPlanes
        object.material.needsUpdate = true
        object.raycast = makeClippedCast(object, object.raycast, root.object, parentClippingRect, orderInfo)
      }
    })
    const parent = content.parent
    content.parent = null
    box3Helper.setFromObject(content)
    box3Helper.getSize(measuredSize).max(smallValue)
    sizeSignal.value = measuredSize

    if (parent != null) {
      content.parent = parent
    }
    box3Helper.getCenter(measuredCenter)
    root.requestRender()
  }
  initializers.push(
    () =>
      effect(() => {
        updateRenderProperties(
          contentContainerRef.current,
          isVisible.value,
          root.renderOrder.value,
          root.depthTest.value,
        )
        root.requestRender()
      }),
    (subscriptions) => {
      const content = contentContainerRef.current
      if (content == null) {
        return subscriptions
      }
      measureContent()
      subscriptions.push(
        effect(() => {
          const {
            size: { value: size },
            paddingInset: { value: paddingInset },
            borderInset: { value: borderInset },
          } = flexState
          if (size == null || paddingInset == null || borderInset == null) {
            return
          }
          const [width, height] = size
          const [pTop, pRight, pBottom, pLeft] = paddingInset
          const [bTop, bRight, bBottom, bLeft] = borderInset
          const topInset = pTop + bTop
          const rightInset = pRight + bRight
          const bottomInset = pBottom + bBottom
          const leftInset = pLeft + bLeft

          const innerWidth = width - leftInset - rightInset
          const innerHeight = height - topInset - bottomInset

          const pixelSize = root.pixelSize.value
          content.scale
            .set(
              innerWidth * pixelSize,
              innerHeight * pixelSize,
              keepAspectRatio.value ? (innerHeight * pixelSize * measuredSize.z) / measuredSize.y : measuredSize.z,
            )
            .divide(measuredSize)

          content.position.copy(measuredCenter).negate()

          content.position.z -= alignmentZMap[depthAlign.value] * measuredSize.z
          content.position.multiply(content.scale)
          content.position.add(
            vectorHelper.set((leftInset - rightInset) * 0.5 * pixelSize, (bottomInset - topInset) * 0.5 * pixelSize, 0),
          )
          content.updateMatrix()
          root.requestRender()
        }),
      )
      return subscriptions
    },
  )
  return () => {
    updateRenderProperties(
      contentContainerRef.current,
      isVisible.peek(),
      root.renderOrder.peek(),
      root.depthTest.peek(),
    )
    measureContent()
  }
}
