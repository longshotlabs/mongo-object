import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { cleanNulls, expandKey, reportNulls } from './util.ts'

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
        /* eslint-disable no-sparse-arrays -- Cleaning leaves holes in arrays. */
        b: [
          ,
          {
            e: [, 'keep']
          }
        ]
        /* eslint-enable no-sparse-arrays */
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

  test('cleanNulls and reportNulls preserve prototype-named own data properties', () => {
    const doc = JSON.parse('{"__proto__": {"ppBullseye": true}, "constructor": 1, "prototype": 2}')
    const cleaned = cleanNulls(doc)
    assert.deepStrictEqual(cleaned, doc)
    assert.equal(Object.getPrototypeOf(cleaned), Object.prototype)
    assert.equal(Object.hasOwn(Object.prototype, 'ppBullseye'), false)

    const nullDoc = JSON.parse('{"__proto__": null, "constructor": null, "prototype": null}')
    const reported = reportNulls(nullDoc)
    assert.deepStrictEqual(
      reported,
      JSON.parse('{"__proto__": "", "constructor": "", "prototype": ""}')
    )
    assert.equal(Object.getPrototypeOf(reported), Object.prototype)
  })

  test('expandKey - prevents prototype pollution via __proto__', () => {
    const obj = {}
    expandKey('polluted', '__proto__[polluted]', obj)
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!{}.hasOwnProperty('polluted'))
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!Object.prototype.hasOwnProperty('polluted'))
  })

  test('expandKey - prevents prototype pollution via constructor', () => {
    const obj = {}
    expandKey('polluted', 'constructor[polluted]', obj)
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!{}.hasOwnProperty('polluted'))
  })

  test('expandKey - prevents prototype pollution via prototype', () => {
    const obj = {}
    expandKey('polluted', 'prototype[polluted]', obj)
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!{}.hasOwnProperty('polluted'))
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

  test('expandKey validates complete paths and does not traverse inherited objects', () => {
    const obj = {}
    expandKey('polluted', 'safe[__proto__][ppBullseye]', obj)
    assert.deepStrictEqual(obj, {})

    const inherited = { child: { value: 1 } }
    const doc = Object.create(inherited)
    expandKey(2, 'child[value]', doc)
    assert.deepStrictEqual(inherited, { child: { value: 1 } })
    assert.deepStrictEqual(doc.child, { value: 2 })
  })
})
