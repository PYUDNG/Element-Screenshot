import { afterEach, describe, expect, it, vi } from 'vitest'
import { toBlob } from 'html-to-image'
import { native } from '../src/core/native'
import { captureBackdropScene, hasComplexBackground } from '../src/core/backdrop-scene'

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }))

const toBlobMock = vi.mocked(toBlob)

afterEach(() => {
  vi.restoreAllMocks()
  toBlobMock.mockReset()
  document.body.innerHTML = ''
})

function mockPageStyles(backgroundImage: string, backgroundColor = 'rgba(0, 0, 0, 0)'): void {
  vi.spyOn(native, 'getComputedStyle').mockImplementation((element) => {
    const isRoot = element === document.documentElement || element === document.body
    return {
      backgroundImage: isRoot ? backgroundImage : 'none',
      backgroundColor: isRoot ? backgroundColor : 'rgba(0, 0, 0, 0)',
      backgroundSize: 'auto',
      backgroundPosition: '0% 0%',
      backgroundRepeat: 'repeat',
      backgroundOrigin: 'padding-box',
      backgroundClip: 'border-box',
      backgroundAttachment: 'scroll',
      backgroundBlendMode: 'normal',
      opacity: '1'
    } as CSSStyleDeclaration
  })
  vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({})
  } as DOMRect)
}

describe('complex page backgrounds', () => {
  it('does not treat a solid body background as complex', () => {
    mockPageStyles('none', 'rgb(21, 21, 23)')
    const card = document.createElement('div')
    document.body.appendChild(card)

    expect(hasComplexBackground(card)).toBe(false)
  })

  it('detects a gradient on the page root', () => {
    mockPageStyles('linear-gradient(135deg, rgb(15, 23, 42), rgb(124, 58, 237))')
    const card = document.createElement('div')
    document.body.appendChild(card)

    expect(hasComplexBackground(card)).toBe(true)
  })

  it('renders the page background into a crop-sized offscreen layer', async () => {
    mockPageStyles('linear-gradient(135deg, rgb(15, 23, 42), rgb(124, 58, 237))', 'rgb(15, 23, 42)')
    const card = document.createElement('div')
    document.body.appendChild(card)
    let captured: HTMLElement | null = null
    toBlobMock.mockImplementation(async (element) => {
      captured = element as HTMLElement
      return new Blob(['scene'], { type: 'image/png' })
    })

    const blob = await captureBackdropScene(
      card,
      { left: 10, top: 20, width: 300, height: 400 },
      2,
      'rgb(15, 23, 42)'
    )

    expect(blob?.type).toBe('image/png')
    expect(captured).not.toBeNull()
    const wrapper = captured as unknown as HTMLElement
    expect(wrapper.style.backgroundColor).toBe('rgb(15, 23, 42)')
    expect(wrapper.style.overflow).toBe('hidden')
    const layer = wrapper.firstElementChild as HTMLElement
    expect(layer.style.backgroundImage).toContain('linear-gradient')
    expect(Number.parseFloat(layer.style.width)).toBeGreaterThanOrEqual(800)
    expect(Number.parseFloat(layer.style.height)).toBeGreaterThanOrEqual(600)
    expect(document.body.contains(wrapper)).toBe(false)
  })

  it('skips scene capture when the page has no image background', async () => {
    mockPageStyles('none', 'rgb(21, 21, 23)')
    const card = document.createElement('div')
    document.body.appendChild(card)

    await expect(
      captureBackdropScene(card, { left: 0, top: 0, width: 100, height: 100 }, 1, '#fff')
    ).resolves.toBeNull()
    expect(toBlobMock).not.toHaveBeenCalled()
  })
})
