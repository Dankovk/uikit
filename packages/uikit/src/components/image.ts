import { Signal, computed, effect, signal } from '@preact/signals-core'
import {
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2Tuple,
} from 'three'
import { Listeners } from '../index.js'
import { Object3DRef, ParentContext, RootContext } from '../context.js'
import { FlexNode, FlexNodeState, Inset, YogaProperties, createFlexNodeState } from '../flex/index.js'
import { ElementType, OrderInfo, ZIndexProperties, computedOrderInfo, setupRenderOrder } from '../order.js'
import {} from '../panel/instanced-panel.js'
import {
  PanelDepthMaterial,
  PanelDistanceMaterial,
  createPanelMaterial,
  createPanelMaterialConfig,
  PanelGroupProperties,
  panelGeometry,
  PanelProperties,
  PanelMaterialConfig,
} from '../panel/index.js'
import { WithAllAliases } from '../properties/alias.js'
import { AllOptionalProperties, WithClasses, WithReactive } from '../properties/default.js'
import {
  ScrollbarProperties,
  applyScrollPosition,
  computedGlobalScrollMatrix,
  createScrollPosition,
  createScrollbars,
  computedScrollHandlers,
  computedAnyAncestorScrollable,
} from '../scroll.js'
import { TransformProperties, applyTransform, computedTransformMatrix } from '../transform.js'
import {
  VisibilityProperties,
  WithConditionals,
  computedGlobalMatrix,
  computedHandlers,
  computedIsVisible,
  computedMergedProperties,
  createNode,
  keepAspectRatioPropertyTransformer,
  loadResourceWithParams,
} from './utils.js'
import { MergedProperties } from '../properties/merged.js'
import { Initializers, readReactive, unsubscribeSubscriptions } from '../utils.js'
import { setupImmediateProperties } from '../properties/immediate.js'
import { makeClippedCast, makePanelRaycast, makePanelSpherecast } from '../panel/interaction-panel-mesh.js'
import { computedIsClipped, computedClippingRect, createGlobalClippingPlanes } from '../clipping.js'
import { setupLayoutListeners, setupClippedListeners } from '../listeners.js'
import { computedInheritableProperty } from '../properties/utils.js'
import { createActivePropertyTransfomers } from '../active.js'
import { createHoverPropertyTransformers, setupCursorCleanup } from '../hover.js'
import { createResponsivePropertyTransformers } from '../responsive.js'
import { AppearanceProperties } from './svg.js'
import { darkPropertyTransformers } from '../dark.js'

export type ImageFit = 'cover' | 'fill'
const defaultImageFit: ImageFit = 'fill'

export type InheritableImageProperties = WithClasses<
  WithConditionals<
    WithAllAliases<
      WithReactive<
        YogaProperties &
          ZIndexProperties &
          Omit<PanelProperties, 'backgroundColor' | 'backgroundOpacity'> &
          TransformProperties &
          AppearanceProperties &
          PanelGroupProperties &
          ScrollbarProperties &
          KeepAspectRatioProperties &
          ImageFitProperties &
          VisibilityProperties
      >
    >
  >
>

export type ImageFitProperties = {
  objectFit?: ImageFit
}

export type KeepAspectRatioProperties = {
  keepAspectRatio?: boolean
}

export type ImageProperties = InheritableImageProperties & Listeners & WithReactive<{ src?: string | Texture }>

export function createImage(
  parentContext: ParentContext,
  style: Signal<ImageProperties | undefined>,
  properties: Signal<ImageProperties | undefined>,
  defaultProperties: Signal<AllOptionalProperties | undefined>,
  object: Object3DRef,
  childrenContainer: Object3DRef,
) {
  const initializers: Initializers = []
  const texture = signal<Texture | undefined>(undefined)
  const hoveredSignal = signal<Array<number>>([])
  const activeSignal = signal<Array<number>>([])
  setupCursorCleanup(hoveredSignal, initializers)

  const src = computed(() => readReactive(style.value?.src) ?? readReactive(properties.value?.src))
  loadResourceWithParams(texture, loadTextureImpl, cleanupTexture, initializers, src)

  const textureAspectRatio = computed(() => {
    const tex = texture.value
    if (tex == null) {
      return undefined
    }
    const image = tex.source.data as { width: number; height: number }
    return image.width / image.height
  })

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
    (m) => m.add('aspectRatio', textureAspectRatio),
  )

  const node = signal<FlexNode | undefined>(undefined)
  const flexState = createFlexNodeState()
  createNode(node, flexState, parentContext, mergedProperties, object, true, initializers)

  const transformMatrix = computedTransformMatrix(mergedProperties, flexState, parentContext.root.pixelSize)
  applyTransform(parentContext.root, object, transformMatrix, initializers)

  const globalMatrix = computedGlobalMatrix(parentContext.childrenMatrix, transformMatrix)

  const isClipped = computedIsClipped(
    parentContext.clippingRect,
    globalMatrix,
    flexState.size,
    parentContext.root.pixelSize,
  )
  const isHidden = computed(() => isClipped.value || texture.value == null)

  const isVisible = computedIsVisible(flexState, isHidden, mergedProperties)

  const orderInfo = computedOrderInfo(mergedProperties, ElementType.Image, undefined, parentContext.orderInfo)

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
  const interactionPanel = createImageMesh(
    mergedProperties,
    texture,
    parentContext,
    flexState,
    orderInfo,
    parentContext.root,
    isVisible,
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
    scrollPosition,
    isClipped,
    isVisible,
    mergedProperties,
    anyAncestorScrollable: computedAnyAncestorScrollable(flexState.scrollable, parentContext.anyAncestorScrollable),
    initializers,
    handlers: computedHandlers(style, properties, defaultProperties, hoveredSignal, activeSignal, scrollHandlers),
    interactionPanel,
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
  })
}

let imageMaterialConfig: PanelMaterialConfig | undefined
function getImageMaterialConfig() {
  imageMaterialConfig ??= createPanelMaterialConfig(
    {
      borderBend: 'borderBend',
      borderBottomLeftRadius: 'borderBottomLeftRadius',
      borderBottomRightRadius: 'borderBottomRightRadius',
      borderColor: 'borderColor',
      borderOpacity: 'borderOpacity',
      borderTopLeftRadius: 'borderTopLeftRadius',
      borderTopRightRadius: 'borderTopRightRadius',
      backgroundOpacity: 'opacity',
    },
    {
      backgroundColor: 0xffffff,
    },
  )
  return imageMaterialConfig
}

function createImageMesh(
  propertiesSignal: Signal<MergedProperties>,
  textureSignal: Signal<Texture | undefined>,
  parentContext: ParentContext,
  flexState: FlexNodeState,
  orderInfo: Signal<OrderInfo | undefined>,
  root: RootContext,
  isVisible: Signal<boolean>,
  initializers: Initializers,
) {
  const mesh = new Mesh<PlaneGeometry, MeshBasicMaterial>(panelGeometry)
  mesh.matrixAutoUpdate = false
  const clippingPlanes = createGlobalClippingPlanes(root, parentContext.clippingRect)
  const isMeshVisible = getImageMaterialConfig().computedIsVisibile(
    propertiesSignal,
    flexState.borderInset,
    flexState.size,
    isVisible,
  )
  setupImageMaterials(
    propertiesSignal,
    mesh,
    flexState.size,
    flexState.borderInset,
    isMeshVisible,
    clippingPlanes,
    root,
    initializers,
  )
  mesh.raycast = makeClippedCast(mesh, makePanelRaycast(mesh), root.object, parentContext.clippingRect, orderInfo)
  mesh.spherecast = makeClippedCast(mesh, makePanelSpherecast(mesh), root.object, parentContext.clippingRect, orderInfo)
  setupRenderOrder(mesh, root, orderInfo)
  const objectFit = computedInheritableProperty(propertiesSignal, 'objectFit', defaultImageFit)
  initializers.push(
    () =>
      effect(() => {
        const texture = textureSignal.value
        if (texture == null || flexState.size.value == null || flexState.borderInset.value == null) {
          return
        }
        texture.matrix.identity()
        root.requestRender()

        if (objectFit.value === 'fill' || texture == null) {
          transformInsideBorder(flexState.borderInset, flexState.size, texture)
          return
        }

        const { width: textureWidth, height: textureHeight } = texture.source.data as { width: number; height: number }
        const textureRatio = textureWidth / textureHeight

        const [width, height] = flexState.size.value
        const [top, right, bottom, left] = flexState.borderInset.value
        const boundsRatioValue = (width - left - right) / (height - top - bottom)

        if (textureRatio > boundsRatioValue) {
          texture.matrix
            .translate(-(0.5 * (boundsRatioValue - textureRatio)) / boundsRatioValue, 0)
            .scale(boundsRatioValue / textureRatio, 1)
        } else {
          texture.matrix
            .translate(0, -(0.5 * (textureRatio - boundsRatioValue)) / textureRatio)
            .scale(1, textureRatio / boundsRatioValue)
        }
        transformInsideBorder(flexState.borderInset, flexState.size, texture)
      }),
    () =>
      effect(() => {
        mesh.visible = isMeshVisible.value
        parentContext.root.requestRender()
      }),
    () =>
      effect(() => {
        const map = textureSignal.value ?? null
        if (mesh.material.map === map) {
          return
        }
        mesh.material.map = map
        mesh.material.needsUpdate = true
        parentContext.root.requestRender()
      }),
    () =>
      effect(() => {
        if (flexState.size.value == null) {
          return
        }
        const [width, height] = flexState.size.value
        const pixelSize = parentContext.root.pixelSize.value
        mesh.scale.set(width * pixelSize, height * pixelSize, 1)
        mesh.updateMatrix()
        parentContext.root.requestRender()
      }),
  )
  return mesh
}

function transformInsideBorder(
  borderInset: Signal<Inset | undefined>,
  size: Signal<Vector2Tuple | undefined>,
  texture: Texture,
): void {
  if (size.value == null || borderInset.value == null) {
    return
  }

  const [outerWidth, outerHeight] = size.value
  const [top, right, bottom, left] = borderInset.value

  const width = outerWidth - left - right
  const height = outerHeight - top - bottom

  texture.matrix
    .translate(-1 + (left + width) / outerWidth, -1 + (top + height) / outerHeight)
    .scale(outerWidth / width, outerHeight / height)
}

const textureLoader = new TextureLoader()

function cleanupTexture(texture: (Texture & { disposable?: boolean }) | undefined): void {
  if (texture?.disposable === true) {
    texture.dispose()
  }
}

async function loadTextureImpl(src?: string | Texture): Promise<(Texture & { disposable?: boolean }) | undefined> {
  if (src == null) {
    return Promise.resolve(undefined)
  }
  if (src instanceof Texture) {
    return Promise.resolve(src)
  }
  try {
    const texture = await textureLoader.loadAsync(src)
    texture.colorSpace = SRGBColorSpace
    texture.matrixAutoUpdate = false
    return Object.assign(texture, { disposable: true })
  } catch (error) {
    console.error(error)
    return undefined
  }
}

function setupImageMaterials(
  propertiesSignal: Signal<MergedProperties>,
  target: Mesh,
  size: Signal<Vector2Tuple | undefined>,
  borderInset: Signal<Inset | undefined>,
  isVisible: Signal<boolean>,
  clippingPlanes: Array<Plane>,
  root: RootContext,
  initializers: Initializers,
) {
  const data = new Float32Array(16)
  const info = { data: data, type: 'normal' } as const
  target.customDepthMaterial = new PanelDepthMaterial(info)
  target.customDistanceMaterial = new PanelDistanceMaterial(info)
  target.customDepthMaterial.clippingPlanes = clippingPlanes
  target.customDistanceMaterial.clippingPlanes = clippingPlanes

  const panelMaterialClass = computedInheritableProperty(propertiesSignal, 'panelMaterialClass', MeshBasicMaterial)
  initializers.push((subscriptions) => {
    subscriptions.push(
      effect(() => {
        const material = createPanelMaterial(panelMaterialClass.value, info)
        material.clippingPlanes = clippingPlanes
        target.material = material
        const cleanupDepthTestEffect = effect(() => {
          material.depthTest = root.depthTest.value
          root.requestRender()
        })
        return () => {
          cleanupDepthTestEffect()
          material.dispose()
        }
      }),
      effect(() => {
        target.renderOrder = root.renderOrder.value
        root.requestRender()
      }),
      effect(() => {
        target.castShadow = propertiesSignal.value.read('castShadow', false)
        root.requestRender()
      }),
      effect(() => {
        target.receiveShadow = propertiesSignal.value.read('receiveShadow', false)
        root.requestRender()
      }),
    )
    return subscriptions
  })

  const imageMaterialConfig = getImageMaterialConfig()
  const internalSubscriptions: Array<() => void> = []
  initializers.push(() =>
    effect(() => {
      if (!isVisible.value) {
        return
      }

      data.set(imageMaterialConfig.defaultData)

      internalSubscriptions.push(
        effect(() => size.value != null && data.set(size.value, 13)),
        effect(() => borderInset.value != null && data.set(borderInset.value, 0)),
      )
      root.requestRender()
      return () => unsubscribeSubscriptions(internalSubscriptions)
    }),
  )
  const setters = imageMaterialConfig.setters
  initializers.push((subscriptions) => {
    setupImmediateProperties(
      propertiesSignal,
      isVisible,
      imageMaterialConfig.hasProperty,
      (key, value) => {
        setters[key](data, 0, value as any, size, undefined)
        root.requestRender()
      },
      subscriptions,
    )
    return subscriptions
  })
}
