/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { cleanNulls, expandKey, reportNulls } from './util.js'

describe('util', () => {
  test('cleanNulls', () => {
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

    assert.deepStrictEqual(cleaned, {
      e: 'keep me',
      f: { e: 'keep me' },
      h: { a: date }
    })
  })

  test('cleanNulls with arrays', () => {
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

    assert.deepStrictEqual(cleaned, {
      a: {
        // eslint-disable-next-line no-sparse-arrays
        b: [
          ,
          {
            // eslint-disable-next-line no-sparse-arrays
            e: [, 'keep']
          }
        ]
      }
    })
  })

  test('reportNulls', () => {
    const report = reportNulls({
      a: undefined,
      b: undefined,
      c: null,
      d: '',
      e: 'keep me'
    })
    assert.deepStrictEqual(report, {
      a: '',
      b: '',
      c: '',
      d: ''
    })
  })

  test('expandKey - prevents prototype pollution via __proto__', () => {
    const obj = {}
    expandKey('polluted', '__proto__[polluted]', obj)
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!({}).hasOwnProperty('polluted'))
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!Object.prototype.hasOwnProperty('polluted'))
  })

  test('expandKey - prevents prototype pollution via constructor', () => {
    const obj = {}
    expandKey('polluted', 'constructor[polluted]', obj)
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!({}).hasOwnProperty('polluted'))
  })

  test('expandKey - prevents prototype pollution via prototype', () => {
    const obj = {}
    expandKey('polluted', 'prototype[polluted]', obj)
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!({}).hasOwnProperty('polluted'))
  })

  test('expandKey - normal operation still works', () => {
    const obj = {}
    expandKey('value1', 'a', obj)
    assert.deepStrictEqual(obj, { a: 'value1' })

    const obj2 = {}
    expandKey('value2', 'a[b]', obj2)
    assert.deepStrictEqual(obj2, { a: { b: 'value2' } })

    const obj3 = {}
    expandKey('value3', 'a[b][0]', obj3)
    assert.deepStrictEqual(obj3, { a: { b: ['value3'] } })
  })
})
