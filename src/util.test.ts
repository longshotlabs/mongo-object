import expect from 'expect'

import { cleanNulls, expandKey, reportNulls } from './util.js'

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

  it('expandKey - prevents prototype pollution via __proto__', () => {
    const obj = {}
    expandKey('polluted', '__proto__[polluted]', obj)
    expect(({})).not.toHaveProperty('polluted')
    expect(Object.prototype).not.toHaveProperty('polluted')
  })

  it('expandKey - prevents prototype pollution via constructor', () => {
    const obj = {}
    expandKey('polluted', 'constructor[polluted]', obj)
    expect(({})).not.toHaveProperty('polluted')
  })

  it('expandKey - prevents prototype pollution via prototype', () => {
    const obj = {}
    expandKey('polluted', 'prototype[polluted]', obj)
    expect(({})).not.toHaveProperty('polluted')
  })

  it('expandKey - normal operation still works', () => {
    const obj = {}
    expandKey('value1', 'a', obj)
    expect(obj).toEqual({ a: 'value1' })

    const obj2 = {}
    expandKey('value2', 'a[b]', obj2)
    expect(obj2).toEqual({ a: { b: 'value2' } })

    const obj3 = {}
    expandKey('value3', 'a[b][0]', obj3)
    expect(obj3).toEqual({ a: { b: ['value3'] } })
  })
})
