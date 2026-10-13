import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import MongoObject, {
  type GetFlatObjectOptions,
  type KeyInfo,
  type MongoDoc
} from './mongo-object.ts'

function passthru(doc: MongoDoc): MongoDoc {
  const mDoc = new MongoObject(doc)
  return mDoc.getObject()
}

function rt(doc: MongoDoc): void {
  assert.deepStrictEqual(passthru(doc), doc)
}

function flat(doc: MongoDoc, opts?: GetFlatObjectOptions): Record<string, any> {
  const mDoc = new MongoObject(doc)
  return mDoc.getFlatObject(opts)
}

function testFlat(doc: MongoDoc, exp: Record<string, any>, opts?: GetFlatObjectOptions): void {
  assert.deepStrictEqual(flat(doc, opts), exp)
}

function testRemove(doc: MongoDoc, exp: MongoDoc, pos: string): void {
  const mDoc = new MongoObject(doc)
  mDoc.removeValueForPosition(pos)
  assert.deepStrictEqual(mDoc.getObject(), exp)
}

function testGetVal(doc: MongoDoc, pos: string, exp: any): void {
  const mDoc = new MongoObject(doc)
  assert.deepStrictEqual(mDoc.getValueForPosition(pos), exp)
}

function testGetInfo(doc: MongoDoc, key: string, exp: KeyInfo | undefined): void {
  const mDoc = new MongoObject(doc)
  assert.deepStrictEqual(mDoc.getInfoForKey(key), exp)
}

function convert(key: string, wrapAll: boolean, exp: string): void {
  // We must use non-dot-notation to access private prop and keep TypeScript happy
  // @ts-expect-error private access for testing
  const pos = MongoObject._keyToPosition(key, wrapAll)
  assert.deepStrictEqual(pos, exp)
}

function testMakeKeyGeneric(input: any, expectedOutput: string | null): void {
  const generic = MongoObject.makeKeyGeneric(input)
  assert.deepStrictEqual(generic, expectedOutput)
}

function testExpandObj(val: Record<string, any>, exp: Record<string, any>): void {
  const mod = MongoObject.expandObj(val)
  assert.deepStrictEqual(mod, exp)
}

function testSet(
  doc: MongoDoc,
  exp: MongoDoc,
  pos: string,
  key: string,
  value: any,
  operator: string | null = null
): void {
  const mDoc = new MongoObject(doc)
  mDoc.setValueForPosition(pos, value)

  assert.deepStrictEqual(mDoc.getObject(), exp)

  assert.deepStrictEqual(mDoc.getInfoForKey(key), {
    operator,
    value
  })
}

describe('MongoObject', () => {
  test('round trip', () => {
    // Round Trip Tests
    rt({})
    rt({ a: 1 })
    rt({ a: 'Test' })
    rt({ a: new Date() })
    rt({ a: [] })
    rt({ a: {} })
    rt({ a: [1, 2] })
    rt({ a: ['Test1', 'Test2'] })
    rt({ a: [new Date(), new Date()] })
    rt({ a: { b: 1 } })
    rt({ a: { b: 'Test' } })
    rt({ a: { b: new Date() } })
    rt({ a: { b: [] } })
    rt({ a: { b: {} } })
    rt({ a: { b: [1, 2] } })
    rt({ a: { b: ['Test1', 'Test2'] } })
    rt({ a: { b: [new Date(), new Date()] } })
    rt({ a: { b: [{ c: 1 }, { c: 2 }] } })
    rt({ a: { b: [{ c: 'Test1' }, { c: 'Test2' }] } })
    rt({ a: { b: [{ c: new Date() }, { c: new Date() }] } })
    rt({ string: 't', length: 5 })
  })

  test('typed arrays', () => {
    const mo = new MongoObject({ foo: new Uint8Array(10) })
    // We must use non-dot-notation to access private prop and keep TypeScript happy
    // @ts-expect-error private access for testing
    assert.deepStrictEqual(mo._affectedKeys['foo.0'], undefined)
  })

  test('forEachNode', () => {
    const mo = new MongoObject({ foo: 'k', length: 5 })
    // We must use non-dot-notation to access private prop and keep TypeScript happy
    // @ts-expect-error private access for testing
    assert.deepStrictEqual({ ...mo._affectedKeys }, { foo: 'foo', length: 'length' })

    let count = 0
    mo.forEachNode(() => {
      count += 1
    })
    assert.deepStrictEqual(count, 2)
  })

  test('flat', () => {
    // Flatten Tests
    const testDate = new Date()
    testFlat({}, {})
    testFlat({ a: 1 }, { a: 1 })
    testFlat({ a: 'Test' }, { a: 'Test' })
    testFlat({ a: testDate }, { a: testDate })
    testFlat({ a: [] }, { a: [] })
    testFlat({ a: {} }, { a: {} })
    testFlat({ a: [1, 2] }, { 'a.0': 1, 'a.1': 2 })
    testFlat({ a: [1, 2] }, { a: [1, 2] }, { keepArrays: true })
    testFlat({ a: ['Test1', 'Test2'] }, { 'a.0': 'Test1', 'a.1': 'Test2' })
    testFlat({ a: ['Test1', 'Test2'] }, { a: ['Test1', 'Test2'] }, { keepArrays: true })
    testFlat({ a: [testDate, testDate] }, { 'a.0': testDate, 'a.1': testDate })
    testFlat({ a: [testDate, testDate] }, { a: [testDate, testDate] }, { keepArrays: true })
    testFlat({ a: { b: 1 } }, { 'a.b': 1 })
    testFlat({ a: { b: 'Test' } }, { 'a.b': 'Test' })
    testFlat({ a: { b: testDate } }, { 'a.b': testDate })
    testFlat({ a: { b: [] } }, { 'a.b': [] })
    testFlat({ a: { b: {} } }, { 'a.b': {} })
    testFlat({ a: { b: [1, 2] } }, { 'a.b.0': 1, 'a.b.1': 2 })
    testFlat({ a: { b: [1, 2] } }, { 'a.b': [1, 2] }, { keepArrays: true })
    testFlat({ a: { b: ['Test1', 'Test2'] } }, { 'a.b.0': 'Test1', 'a.b.1': 'Test2' })
    testFlat({ a: { b: ['Test1', 'Test2'] } }, { 'a.b': ['Test1', 'Test2'] }, { keepArrays: true })
    testFlat({ a: { b: [testDate, testDate] } }, { 'a.b.0': testDate, 'a.b.1': testDate })
    testFlat(
      { a: { b: [testDate, testDate] } },
      { 'a.b': [testDate, testDate] },
      { keepArrays: true }
    )
    testFlat({ a: { b: [{ c: 1 }, { c: 2 }] } }, { 'a.b.0.c': 1, 'a.b.1.c': 2 })
    testFlat(
      { a: { b: [{ c: 1 }, { c: 2 }] } },
      { 'a.b': [{ c: 1 }, { c: 2 }] },
      { keepArrays: true }
    )
    testFlat(
      { a: { b: [{ c: 'Test1' }, { c: 'Test2' }] } },
      { 'a.b.0.c': 'Test1', 'a.b.1.c': 'Test2' }
    )
    testFlat(
      { a: { b: [{ c: 'Test1' }, { c: 'Test2' }] } },
      { 'a.b': [{ c: 'Test1' }, { c: 'Test2' }] },
      { keepArrays: true }
    )
    testFlat(
      { a: { b: [{ c: testDate }, { c: testDate }] } },
      { 'a.b.0.c': testDate, 'a.b.1.c': testDate }
    )
    testFlat(
      { a: { b: [{ c: testDate }, { c: testDate }] } },
      { 'a.b': [{ c: testDate }, { c: testDate }] },
      { keepArrays: true }
    )
  })

  test('removeValueForPosition', () => {
    // correctly removed
    testRemove(
      {
        foo: 'bar'
      },
      {},
      'foo'
    )

    // correctly not removed
    testRemove(
      {
        foo: 'bar'
      },
      {
        foo: 'bar'
      },
      'fooBar'
    )

    // all descendents are removed, too
    testRemove(
      {
        foo: {
          bar: 'foobar'
        }
      },
      {},
      'foo'
    )

    // but not siblings
    testRemove(
      {
        foo: {
          bar: 'foobar',
          foobar: 1
        }
      },
      {
        foo: {
          bar: 'foobar'
        }
      },
      'foo[foobar]'
    )
  })

  test('getValueForPosition', () => {
    testGetVal({ $pull: { foo: 'bar' } }, '$pull', { foo: 'bar' })

    testGetVal({ $pull: { foo: 'bar' } }, '$pull[foo]', 'bar')

    testGetVal({ foo: ['bar'] }, 'foo', ['bar'])

    testGetVal({ foo: ['bar'] }, 'foo[0]', 'bar')

    testGetVal({ foo: [{ a: 1 }, { a: 2 }] }, 'foo', [{ a: 1 }, { a: 2 }])

    testGetVal({ foo: [{ a: 1 }, { a: 2 }] }, 'foo[1]', { a: 2 })

    testGetVal({ foo: [{ a: 1 }, { a: 2 }] }, 'foo[1][a]', 2)
  })

  test('getInfoForKey', () => {
    testGetInfo({ $set: { foo: 'bar' } }, 'foo', {
      value: 'bar',
      operator: '$set'
    })

    testGetInfo({ $set: { 'foo.bar': 1 } }, 'foo.bar', {
      value: 1,
      operator: '$set'
    })

    testGetInfo({ $set: { 'foo.bar': 1 } }, '$set', undefined) // Not valid

    testGetInfo({ $set: { 'foo.bar.0': 1 } }, 'foo.bar.0', {
      value: 1,
      operator: '$set'
    })

    testGetInfo({ $pull: { foo: 'bar' } }, 'foo', {
      value: 'bar',
      operator: '$pull'
    })

    testGetInfo({ foo: ['bar'] }, 'foo', { value: ['bar'], operator: null })

    testGetInfo({ foo: ['bar'] }, 'foo.0', { value: 'bar', operator: null })

    testGetInfo({ foo: [{ a: 1 }, { a: 2 }] }, 'foo.1.a', {
      value: 2,
      operator: null
    })

    testGetInfo({ foo: [{ a: 1 }, { a: 2 }] }, 'foo.1', {
      value: { a: 2 },
      operator: null
    })
  })

  test('key lookup preserves the first position and stays current after mutations', () => {
    const mo = new MongoObject({ $set: { foo: 1 }, $unset: { foo: '' } })
    assert.equal(mo.getPositionForKey('foo'), '$set[foo]')
    mo.setValueForPosition('$unset[foo]', 'changed')
    assert.equal(mo.getPositionForKey('foo'), '$set[foo]')
    mo.removeValueForPosition('$set[foo]')
    assert.equal(mo.getPositionForKey('foo'), '$unset[foo]')
    mo.setValueForPosition('$set[foo]', { bar: 2 })
    assert.equal(mo.getPositionForKey('foo'), '$set[foo]')
    assert.equal(mo.getPositionForKey('foo.bar'), '$set[foo][bar]')
    mo.setValueForPosition('$set[foo]', 3)
    assert.equal(mo.getPositionForKey('foo.bar'), undefined)
    mo.removeKey('foo')
    assert.equal(mo.getPositionForKey('foo'), undefined)
    assert.equal(mo.getPositionForKey('missing'), undefined)
  })

  test('key lookup preserves integer property order', () => {
    const mo = new MongoObject({ $set: { 0: 'modifier' } })
    mo.setValueForPosition('0', 'document')
    assert.equal(mo.getPositionForKey('0'), '0')
  })

  test('key lookup tracks adjusted array operators and array compaction', () => {
    const mo = new MongoObject({ $push: { foo: 1 } })
    mo.setValueForPosition('$push[foo]', 2)
    assert.equal(mo.getPositionForKey('foo.0'), '$push[foo]')
    assert.equal(mo.getPositionForKey('foo'), undefined)
    mo.setValueForPosition('$push[foo]', { $each: [{ bar: 1 }] })
    assert.equal(mo.getPositionForKey('foo.0.bar'), '$push[foo][$each][0][bar]')

    const arrayDoc = new MongoObject({ items: [{ a: 1 }, { b: 2 }] })
    arrayDoc.removeValueForPosition('items[0]')
    assert.equal(arrayDoc.getPositionForKey('items.0.a'), undefined)
    arrayDoc.removeArrayItems()
    assert.equal(arrayDoc.getPositionForKey('items.0.b'), 'items[0][b]')
    assert.equal(arrayDoc.getPositionForKey('items.1.b'), undefined)
  })

  test('prototype property names are safe in parsed documents and lookup indexes', () => {
    const names = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']
    const empty = new MongoObject({})
    for (const key of names) {
      assert.equal(empty.getPositionForKey(key), undefined)
      assert.equal(empty.getKeyForPosition(key), undefined)
      assert.deepStrictEqual(empty.getPositionsForGenericKey(key), [])
      assert.deepStrictEqual(empty.getPositionsThatCreateGenericKey(key), [])
    }

    const doc = JSON.parse(
      '{"__proto__": "data", "constructor": 1, "prototype": 2, "toString": 3, "hasOwnProperty": 4}'
    )
    const mo = new MongoObject(doc)
    for (const key of names) {
      assert.equal(mo.getPositionForKey(key), key)
      assert.deepStrictEqual(mo.getPositionsForGenericKey(key), [key])
    }
    assert.deepStrictEqual(mo.getFlatObject(), doc)
    assert.equal(Object.getPrototypeOf(mo.getFlatObject()), Object.prototype)
    assert.deepStrictEqual(MongoObject.docToModifier(doc), { $set: doc })

    const modifier = new MongoObject({ $set: { 'constructor.child': 1, '__proto__.child': 2 } })
    assert.equal(
      modifier.getPositionsThatCreateGenericKey('constructor')[0].position,
      '$set[constructor.child]'
    )
    assert.equal(
      modifier.getPositionsThatCreateGenericKey('__proto__')[0].position,
      '$set[__proto__.child]'
    )
  })

  test('setValueForPosition rejects unsafe paths before making any changes', () => {
    for (const position of [
      '__proto__[ppBullseye]',
      'constructor[prototype][ppBullseye]',
      'safe[__proto__][ppBullseye]',
      'safe[constructor][prototype][ppBullseye]',
      'safe[prototype][ppBullseye]',
      'safe[__proto__]',
      'safe[constructor]',
      'safe[prototype]'
    ]) {
      for (const value of ['polluted', { ppBullseye: true }, undefined]) {
        const doc = { existing: 1 }
        const mo = new MongoObject(doc)
        mo.setValueForPosition(position, value)
        assert.deepStrictEqual(doc, { existing: 1 })
        assert.equal(Object.getPrototypeOf(doc), Object.prototype)
        assert.equal(Object.hasOwn(Object.prototype, 'ppBullseye'), false)
        assert.equal(mo.getKeyForPosition(position), undefined)
      }
    }
    const mo = new MongoObject({})
    mo.addKey('__proto__.ppBullseye', 'polluted', null)
    mo.addKey('constructor.prototype.ppBullseye', 'polluted', null)
    assert.deepStrictEqual(mo.getObject(), {})
  })

  test('position access only traverses own properties', () => {
    const inherited = { child: { value: 1 } }
    const doc = Object.create(inherited)
    const mo = new MongoObject(doc)
    assert.equal(mo.getValueForPosition('child[value]'), undefined)
    mo.removeValueForPosition('child[value]')
    assert.deepStrictEqual(inherited, { child: { value: 1 } })
    mo.setValueForPosition('child[value]', 2)
    assert.deepStrictEqual(inherited, { child: { value: 1 } })
    assert.deepStrictEqual(doc.child, { value: 2 })
    assert.equal(mo.getValueForPosition('__proto__'), undefined)
  })

  test('adding to empty containers refreshes flattening and node metadata', () => {
    const mo = new MongoObject({ flex: { dev: {} }, items: [] })
    mo.setValueForPosition('flex[dev][key]', 'test')
    mo.setValueForPosition('items[0]', 'item')
    assert.deepStrictEqual(mo.getFlatObject(), { 'flex.dev.key': 'test', 'items.0': 'item' })
    assert.deepStrictEqual(mo.getFlatObject({ keepArrays: true }), {
      'flex.dev.key': 'test',
      items: ['item']
    })
    assert.deepStrictEqual(mo.getPositionsForGenericKey('flex.dev.key'), ['flex[dev][key]'])
    assert.deepStrictEqual(mo.getPositionsForGenericKey('items.$'), ['items[0]'])
    let count = 0
    mo.forEachNode(() => {
      count++
    })
    assert.equal(count, 2)
    mo.removeValueForPosition('flex[dev][key]')
    assert.deepStrictEqual(mo.getFlatObject(), { 'flex.dev': {}, 'items.0': 'item' })
  })

  test('_keyToPosition', () => {
    convert('foo', false, 'foo')
    convert('foo', true, '[foo]')
    convert('foo.bar', false, 'foo[bar]')
    convert('foo.bar', true, '[foo][bar]')
    convert('foo.bar.0', false, 'foo[bar][0]')
    convert('foo.bar.0', true, '[foo][bar][0]')
  })

  test('makeKeyGeneric', () => {
    testMakeKeyGeneric(0, null)
    testMakeKeyGeneric({}, null)
    testMakeKeyGeneric('foo', 'foo')
    testMakeKeyGeneric('foo.bar', 'foo.bar')
    testMakeKeyGeneric('foo.$', 'foo.$')
    testMakeKeyGeneric('foo.0.0.ab.c.123.4square.d.67e.f.g.1', 'foo.$.$.ab.c.$.4square.d.67e.f.g.$')
    testMakeKeyGeneric('foo.$[].foo.$[bar].$.$[]', 'foo.$.foo.$.$.$')
    testMakeKeyGeneric(
      'foo.$foo.$foo[bar]foo.foo$[].foo$[bar]',
      'foo.$foo.$foo[bar]foo.foo$[].foo$[bar]'
    )
  })

  test('docToModifier', () => {
    const date = new Date()

    const testObj = {
      a: 1,
      b: 'foo',
      c: date,
      d: {
        a: 1,
        b: 'foo',
        c: date,
        d: [
          {
            a: 1,
            b: 'foo',
            c: date,
            d: {
              a: 1,
              b: 'foo',
              c: date,
              d: null // make sure that null, empty, etc. don't end up in $unset when under an array
            }
          }
        ],
        e: [1, 2]
      },
      e: null,
      f: '',
      g: undefined // undefined props are removed
    }

    // Test 1 w/ keepArrays, w/ keepEmptyStrings
    let mod = MongoObject.docToModifier(testObj, {
      keepArrays: true,
      keepEmptyStrings: true
    })
    assert.deepStrictEqual(mod, {
      $set: {
        a: 1,
        b: 'foo',
        c: date,
        'd.a': 1,
        'd.b': 'foo',
        'd.c': date,
        'd.d': [
          // array of objects should remain array
          {
            a: 1,
            b: 'foo',
            c: date,
            d: {
              a: 1,
              b: 'foo',
              c: date

              // null should have been removed, too
            }
          }
        ],
        'd.e': [1, 2], // array of non-objects should remain array
        f: '' // empty string should be set rather than unset
      },
      $unset: {
        e: ''
      }
    })

    // Test 2 w/ keepArrays, w/o keepEmptyStrings
    mod = MongoObject.docToModifier(testObj, {
      keepArrays: true,
      keepEmptyStrings: false
    })
    assert.deepStrictEqual(mod, {
      $set: {
        a: 1,
        b: 'foo',
        c: date,
        'd.a': 1,
        'd.b': 'foo',
        'd.c': date,
        'd.d': [
          // array of objects should remain array
          {
            a: 1,
            b: 'foo',
            c: date,
            d: {
              a: 1,
              b: 'foo',
              c: date

              // null should have been removed, too
            }
          }
        ],
        'd.e': [1, 2] // array of non-objects should remain array
      },
      $unset: {
        e: '',
        f: ''
      }
    })

    // Test 3 w/o keepArrays, w/ keepEmptyStrings
    mod = MongoObject.docToModifier(testObj, {
      keepArrays: false,
      keepEmptyStrings: true
    })
    assert.deepStrictEqual(mod, {
      $set: {
        a: 1,
        b: 'foo',
        c: date,
        'd.a': 1,
        'd.b': 'foo',
        'd.c': date,
        'd.d.0.a': 1,
        'd.d.0.b': 'foo',
        'd.d.0.c': date,
        'd.d.0.d.a': 1,
        'd.d.0.d.b': 'foo',
        'd.d.0.d.c': date,
        'd.e.0': 1,
        'd.e.1': 2,
        f: ''
      },
      $unset: {
        'd.d.0.d.d': '',
        e: ''
      }
    })

    // Test 4 w/o keepArrays, w/o keepEmptyStrings
    mod = MongoObject.docToModifier(testObj, {
      keepArrays: false,
      keepEmptyStrings: false
    })
    assert.deepStrictEqual(mod, {
      $set: {
        a: 1,
        b: 'foo',
        c: date,
        'd.a': 1,
        'd.b': 'foo',
        'd.c': date,
        'd.d.0.a': 1,
        'd.d.0.b': 'foo',
        'd.d.0.c': date,
        'd.d.0.d.a': 1,
        'd.d.0.d.b': 'foo',
        'd.d.0.d.c': date,
        'd.e.0': 1,
        'd.e.1': 2
      },
      $unset: {
        'd.d.0.d.d': '',
        e: '',
        f: ''
      }
    })
  })

  test('expandObj', () => {
    testExpandObj({}, {})
    testExpandObj({ foo: 'bar' }, { foo: 'bar' })
    testExpandObj({ foo: 'bar', baz: 1 }, { foo: 'bar', baz: 1 })
    testExpandObj(
      {
        'foo.bar': 'baz',
        baz: 1
      },
      {
        foo: { bar: 'baz' },
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.bar.0': 'foo',
        'foo.bar.1': 'baz',
        baz: 1
      },
      {
        foo: { bar: ['foo', 'baz'] },
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.bar.1': 'baz',
        baz: 1
      },
      {
        foo: { bar: [, 'baz'] }, // eslint-disable-line no-sparse-arrays
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.bar.1.bam': 'baz',
        baz: 1
      },
      {
        foo: { bar: [, { bam: 'baz' }] }, // eslint-disable-line no-sparse-arrays
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.bar.0': null,
        'foo.bar.1.bam': 'baz',
        baz: 1
      },
      {
        foo: { bar: [null, { bam: 'baz' }] },
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.bar.0': 'baz',
        'foo.bar.1.bam': 'baz',
        baz: 1
      },
      {
        foo: { bar: ['baz', { bam: 'baz' }] },
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.bar.0': 'baz',
        'foo.bar.1.bam': 'baz',
        'foo.bar.1.boo': 'foo',
        baz: 1
      },
      {
        foo: { bar: ['baz', { bam: 'baz', boo: 'foo' }] },
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.0': null,
        'foo.1.bar': 'baz',
        baz: 1
      },
      {
        foo: [null, { bar: 'baz' }],
        baz: 1
      }
    )
    testExpandObj(
      {
        'foo.0': null,
        'foo.1.bar': null,
        baz: 1
      },
      {
        foo: [null, { bar: null }],
        baz: 1
      }
    )
  })

  test('expandObj - prevents prototype pollution via __proto__', () => {
    const result = MongoObject.expandObj(JSON.parse('{"__proto__.ppBullseye": "polluted", "a": 1}'))
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!Object.prototype.hasOwnProperty('ppBullseye'))
    assert.deepStrictEqual(result, { a: 1 })
  })

  test('expandObj - prevents prototype pollution via constructor.prototype', () => {
    const result = MongoObject.expandObj({ 'constructor.prototype.ppBullseye': 'polluted', a: 1 })
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!Object.prototype.hasOwnProperty('ppBullseye'))
    assert.deepStrictEqual(result, { a: 1 })
  })

  test('expandObj - prevents prototype pollution via nested __proto__', () => {
    const result = MongoObject.expandObj(
      JSON.parse('{"a.__proto__.ppBullseye": "polluted", "b": 1}')
    )
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!Object.prototype.hasOwnProperty('ppBullseye'))
    assert.deepStrictEqual(result, { b: 1 })
  })

  test('expandObj - prevents prototype pollution via nested constructor.prototype', () => {
    const result = MongoObject.expandObj({ 'a.constructor.prototype.ppBullseye': 'polluted', b: 1 })
    // eslint-disable-next-line no-prototype-builtins
    assert.ok(!Object.prototype.hasOwnProperty('ppBullseye'))
    assert.deepStrictEqual(result, { b: 1 })
  })

  test('expandObj does not traverse inherited prototype functions', () => {
    try {
      const expanded = MongoObject.expandObj({ 'toString.ppBullseye': 'data' })
      assert.equal(Object.hasOwn(Object.prototype.toString, 'ppBullseye'), false)
      assert.deepStrictEqual(expanded, { toString: { ppBullseye: 'data' } })
    } finally {
      Reflect.deleteProperty(Object.prototype.toString, 'ppBullseye')
    }
  })

  void test('setValueForPosition', () => {
    // Correctly set depth 1
    testSet({}, { foo: 'bar' }, 'foo', 'foo', 'bar')

    // Correctly set nested object
    testSet(
      {
        foo: {
          bar: {}
        }
      },
      {
        foo: {
          bar: {
            baz: 'baz'
          }
        }
      },
      'foo[bar][baz]',
      'foo.bar.baz',
      'baz'
    )

    // Should remove descendants
    testSet(
      {
        foo: {
          bar: {
            baz: 'baz'
          }
        }
      },
      {
        foo: {
          bar: 'bar'
        }
      },
      'foo[bar]',
      'foo.bar',
      'bar'
    )

    // Should not set siblings
    testSet(
      {
        foo: {
          bar: 'foobar',
          foobar: 1
        }
      },
      {
        foo: {
          bar: 'baz',
          foobar: 1
        }
      },
      'foo[bar]',
      'foo.bar',
      'baz'
    )

    // Correctly set with $set
    testSet(
      {
        $set: {
          bar: 'bar'
        }
      },
      { $set: { bar: 'foo' } },
      '$set[bar]',
      'bar',
      'foo',
      '$set'
    )
  })
})
