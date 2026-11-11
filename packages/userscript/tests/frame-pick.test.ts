import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectFramePickCandidates } from '../src/core/frame-pick'
import { native } from '../src/core/native'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

/** Boxes per element; everything else reports an empty rect. */
function placeBoxes(boxes: Map<Element, DOMRect>): void {
  vi.spyOn(native, 'getBoundingClientRect').mockImplementation(
    (element) => boxes.get(element) ?? rect(0, 0, 0, 0)
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('frame pick candidates', () => {
  it('describes the stack in frame coordinates, topmost first', () => {
    const card = document.createElement('div')
    card.className = 'card'
    const text = document.createElement('span')
    text.className = 'tick'
    card.append(text)
    document.body.append(card)
    placeBoxes(
      new Map<Element, DOMRect>([
        [card, rect(0, 0, 100, 200)],
        [text, rect(10, 20, 30, 40)]
      ])
    )

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [text, card, document.body])
    })

    const candidates = collectFramePickCandidates(document, 15, 25)

    expect(candidates.map((candidate) => candidate.element)).toEqual([
      text,
      card,
      document.body
    ])
    expect(candidates.map((candidate) => candidate.item.label)).toEqual([
      'span.tick',
      'div.card',
      'body'
    ])
    expect(candidates[0]?.item).toMatchObject({
      id: 0,
      left: 10,
      top: 20,
      width: 30,
      height: 40,
      scrollAxis: null,
      fullPage: false
    })
  })

  it('answers with no layers when nothing is under the point', () => {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => []
    })
    expect(collectFramePickCandidates(document, 1, 1)).toEqual([])
  })
})
