import assert from 'assert'
import expectPkg from 'expect'

import { cleanNulls, each, reportNulls } from './util.js'

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

  describe('each', function () {
    it('should iterate over an array', function () {
      const arr = [1, 2, 3]
      const result: any = []
      each(arr, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        return true
      })
      assert.deepStrictEqual(result, [['0', 1], ['1', 2], ['2', 3]])
    })

    it('should iterate over an object', function () {
      const obj = { a: 1, b: 2, c: 3 }
      const result: any = []
      each(obj, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        return true
      })
      assert.deepStrictEqual(result, [['a', 1], ['b', 2], ['c', 3]])
    })

    it('should handle null and undefined collections', function () {
      const result: any = []
      each(null, function (item, keyOrIndex, obj) {
        assert(false)
      })
      assert.deepStrictEqual(result, [])
      each(undefined, function (item, keyOrIndex, obj) {
        assert(false)
      })
      assert.deepStrictEqual(result, [])
    })

    it('should iterate over an array like object', function () {
      const arrayLike = {
        0: undefined,
        1: 'one',
        2: 'two',
        length: 3
      }
      const result: any = []
      each(arrayLike, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        return true
      })
      assert.deepStrictEqual(result, [
        ['0', undefined],
        ['1', 'one'],
        ['2', 'two']
      ])
    })

    it('should stop iteration over an array like object when iteratee returns false', function () {
      const arrayLike = {
        0: 'zero',
        1: 'one',
        2: 'two',
        length: 3
      }
      const result: any = []
      each(arrayLike, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        if (keyOrIndex === '1') {
          return false
        }
      })
      assert.deepStrictEqual(result, [['0', 'zero'], ['1', 'one']])
    })

    it('should iterate over an object with length property but not matching quantity of keys', function () {
      const notArrayLike = {
        0: undefined,
        1: 'one',
        2: undefined,
        length: 30
      }
      const result: any = []
      each(notArrayLike, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        return true
      })
      assert.deepStrictEqual(result, [
        ['0', undefined],
        ['1', 'one'],
        ['2', undefined],
        ['length', 30]
      ])
    })

    it('should iterate over an object with a length of type string', function () {
      const notArrayLike = {
        0: undefined,
        1: 'one',
        2: undefined,
        length: '30'
      }
      const result: any = []
      each(notArrayLike, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        return true
      })
      assert.deepStrictEqual(result, [
        ['0', undefined],
        ['1', 'one'],
        ['2', undefined],
        ['length', '30']
      ])
    })

    it('should iterate over an array like object with undefined values', function () {
      const arrayLike = {
        0: undefined,
        1: 'one',
        2: undefined,
        length: 3
      }
      const result: any = []
      each(arrayLike, function (item, keyOrIndex, obj) {
        result.push([keyOrIndex, item])
        return true
      })
      assert.deepStrictEqual(result, [
        ['0', undefined],
        ['1', 'one'],
        ['2', undefined]
      ])
    })

    it('should invoke the function with a string normalized key', function () {
      each([1, 2, 3], function (item, keyOrIndex, obj) {
        assert.equal(typeof keyOrIndex, 'string')
        return true
      })
    })
  })
})
