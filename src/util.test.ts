import expectPkg from 'expect'

import { cleanNulls, reportNulls } from './util.js'

const expect = expectPkg.default

describe('util', () => {
  it('cleanNulls', () => {
    const date = new Date()

    const cleaned = cleanNulls({
      a: undefined,
      b: undefined,
      c: null,
      d: '',
      e: 'keep me',
      f: {
        a: undefined,
        b: undefined,
        c: null,
        d: '',
        e: 'keep me'
      },
      g: {
        a: null
      },
      h: {
        a: date
      }
    })

    expect(cleaned).toEqual({
      e: 'keep me',
      f: { e: 'keep me' },
      h: { a: date }
    })
  })

  it('cleanNulls with arrays', () => {
    const cleaned = cleanNulls({
      a: {
        b: [
          {
            c: null,
            d: '',
            e: undefined
          },
          {
            c: null,
            d: '',
            e: [null, 'keep', '', undefined]
          }
        ]
      }
    })

    expect(cleaned).toEqual({
      a: {
        b: [
          undefined,
          {
            e: [undefined, 'keep']
          }
        ]
      }
    })
  })

  it('reportNulls', () => {
    const report = reportNulls({
      a: undefined,
      b: undefined,
      c: null,
      d: '',
      e: 'keep me'
    })
    expect(report).toEqual({
      a: '',
      b: '',
      c: '',
      d: ''
    })
  })
})
