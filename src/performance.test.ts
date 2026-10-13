import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import MongoObject from './mongo-object.ts'

interface NodeContext {
  position: string
  value: any
  isArrayItem: boolean
  updateValue: (value: any) => void
  remove: () => void
}

class CountingMongoObject extends MongoObject {
  // Counts reparses after construction.
  reparses = 0

  _reParseObj(): void {
    super._reParseObj()
    this.reparses = (this.reparses ?? 0) + 1
  }
}

describe('performance regressions', () => {
  test('queued structural updates reparse once and scalar updates need no reparse', () => {
    const mo = new CountingMongoObject({ a: 1, b: 2, c: 3 })
    mo.forEachNode(function (this: NodeContext) {
      this.updateValue(Number(this.value) + 1)
    })
    assert.equal(mo.reparses, 0)
    assert.deepStrictEqual(mo.getFlatObject(), { a: 2, b: 3, c: 4 })
    mo.forEachNode(function (this: NodeContext) {
      this.updateValue({ nested: this.value })
    })
    assert.equal(mo.reparses, 1)
    assert.deepStrictEqual(mo.getFlatObject(), { 'a.nested': 2, 'b.nested': 3, 'c.nested': 4 })
    assert.equal(mo.getPositionForKey('c.nested'), 'c[nested]')
    mo.forEachNode(function (this: NodeContext) {
      this.remove()
    })
    assert.equal(mo.reparses, 2)
    assert.deepStrictEqual(mo.getFlatObject(), { a: {}, b: {}, c: {} })
    assert.equal(mo.getPositionForKey('c.nested'), undefined)
    mo.forEachNode(() => {})
    assert.equal(mo.reparses, 2)
  })

  test('direct writes inside callbacks and after a batch keep indexes current', () => {
    const mo = new CountingMongoObject({ a: 1, b: 2 })
    mo.forEachNode(function (this: NodeContext) {
      if (this.position === 'a') {
        mo.addKey('during.child', 3, null)
        assert.equal(mo.getPositionForKey('during.child'), 'during[child]')
        assert.deepStrictEqual(mo.getPositionsForGenericKey('during.child'), ['during[child]'])
      }
      this.updateValue({ child: this.value })
    })
    assert.equal(mo.reparses, 2)
    assert.deepStrictEqual(mo.getFlatObject(), { 'a.child': 1, 'b.child': 2, 'during.child': 3 })
    mo.setValueForPosition('after', { child: 4 })
    assert.equal(mo.getPositionForKey('after.child'), 'after[child]')
    assert.equal(mo.reparses, 3)
  })

  test('overlapping parent and child updates retain their application order', () => {
    for (const parentValue of [{}, undefined, 'scalar', []]) {
      const mo = new CountingMongoObject({ parent: { child: 1 } })
      mo.forEachNode(
        function (this: NodeContext) {
          this.updateValue(this.position === 'parent' ? parentValue : 2)
        },
        { endPointsOnly: false }
      )
      assert.equal(mo.reparses, 1)
      if (parentValue === 'scalar') {
        assert.deepStrictEqual(mo.getFlatObject(), { parent: 'scalar' })
        assert.equal(mo.getPositionForKey('parent.child'), undefined)
      } else if (Array.isArray(parentValue)) {
        // Non-index array properties are not indexed by the parser.
        assert.equal(mo.getValueForPosition('parent[child]'), 2)
        assert.equal(mo.getPositionForKey('parent.child'), undefined)
      } else {
        assert.deepStrictEqual(mo.getFlatObject(), { 'parent.child': 2 })
        assert.equal(mo.getPositionForKey('parent.child'), 'parent[child]')
      }
    }
  })

  test('queued writes restore indexes after a write throws', () => {
    const doc = { a: 1, b: 2 }
    Object.defineProperty(doc, 'b', { writable: false, configurable: true })
    const mo = new CountingMongoObject(doc)
    assert.throws(() => {
      mo.forEachNode(function (this: NodeContext) {
        this.updateValue({ child: this.value })
      })
    }, TypeError)
    assert.equal(mo.reparses, 1)
    assert.deepStrictEqual(mo.getFlatObject(), { 'a.child': 1, b: 2 })
    assert.equal(mo.getPositionForKey('a.child'), 'a[child]')
    Object.defineProperty(doc, 'b', { writable: true })
    mo.setValueForPosition('b', { child: 3 })
    assert.equal(mo.getPositionForKey('b.child'), 'b[child]')
    assert.equal(mo.reparses, 2)
  })

  test('throwing callbacks do not apply queued writes', () => {
    const mo = new CountingMongoObject({ a: 1, b: 2 })
    assert.throws(() => {
      mo.forEachNode(function (this: NodeContext) {
        this.updateValue({ child: this.value })
        if (this.position === 'b') throw new Error('callback failed')
      })
    }, /callback failed/)
    assert.deepStrictEqual(mo.getFlatObject(), { a: 1, b: 2 })
    assert.equal(mo.reparses, 0)
  })

  test('batches preserve modifier adjustments, duplicate keys, and array compaction', () => {
    const mo = new CountingMongoObject({
      $push: { items: { $each: [1, 2], $slice: 5 } },
      $set: { shared: 1 },
      $unset: { shared: '' }
    })
    mo.forEachNode(function (this: NodeContext) {
      if (this.position.endsWith('[0]')) this.remove()
      else if (this.position.endsWith('[1]')) this.updateValue({ child: 3 })
      else if (this.position === '$set[shared]') this.updateValue({ child: 4 })
    })
    assert.equal(mo.reparses, 1)
    assert.equal(mo.getPositionForKey('shared'), '$set[shared]')
    assert.equal(mo.getPositionForKey('items.1.child'), '$push[items][$each][1][child]')
    mo.removeArrayItems()
    assert.equal(mo.getPositionForKey('items.0.child'), '$push[items][$each][0][child]')
    assert.equal(mo.getPositionForKey('items.1.child'), undefined)
    assert.deepStrictEqual(mo.getObject().$push, { items: { $each: [{ child: 3 }], $slice: 5 } })
  })

  test('set membership preserves endpoints, blackboxes, and keepArrays behavior', () => {
    const mo = new CountingMongoObject(
      {
        opaque: { hidden: 1 },
        empty: {},
        items: [{ child: 2 }, []]
      },
      ['opaque']
    )
    const visited: Array<[string, boolean]> = []
    mo.forEachNode(function (this: NodeContext) {
      visited.push([this.position, this.isArrayItem])
      if (this.position === 'empty') this.updateValue({ child: 3 })
      if (this.position === 'opaque') this.updateValue({ hidden: 4 })
    })
    assert.deepStrictEqual(visited, [
      ['opaque', false],
      ['empty', false],
      ['items[0][child]', false],
      ['items[1]', true]
    ])
    assert.equal(mo.reparses, 1)
    assert.deepStrictEqual(mo.getFlatObject(), {
      opaque: { hidden: 4 },
      'empty.child': 3,
      'items.0.child': 2,
      'items.1': []
    })
    assert.deepStrictEqual(mo.getFlatObject({ keepArrays: true }), {
      opaque: { hidden: 4 },
      'empty.child': 3,
      items: [{ child: 2 }, []]
    })
    assert.equal(mo.getPositionForKey('opaque.hidden'), undefined)
  })

  test('queued unsafe paths remain rejected without prototype changes', () => {
    const doc = JSON.parse('{"__proto__": {"ppBullseye": 1}, "constructor": 2, "safe": 3}')
    const mo = new CountingMongoObject(doc)
    mo.forEachNode(function (this: NodeContext) {
      this.updateValue({ updated: true })
    })
    assert.equal(mo.reparses, 1)
    assert.equal(Object.hasOwn(Object.prototype, 'ppBullseye'), false)
    assert.equal(Object.getPrototypeOf(doc), Object.prototype)
    assert.deepStrictEqual(
      doc,
      JSON.parse('{"__proto__": {"ppBullseye": 1}, "constructor": 2, "safe": {"updated": true}}')
    )
  })

  test('position-only lookup retains fallback and order without reading values', () => {
    const mo = new MongoObject({ $push: { items: 1 }, $set: { 'items.0': 2 } })
    mo.getValueForPosition = () => {
      throw new Error('unexpected value lookup')
    }
    assert.deepStrictEqual(mo.getPositionsForGenericKey('items'), ['$push[items]', '$set[items.0]'])
    assert.deepStrictEqual(mo.getPositionsForGenericKey('items.$'), [
      '$push[items]',
      '$set[items.0]'
    ])
    assert.deepStrictEqual(mo.getPositionsForGenericKey('missing'), [])
    const positions = mo.getPositionsForGenericKey('items')
    positions.length = 0
    assert.equal(mo.getPositionsForGenericKey('items').length, 2)
  })

  test('generic-key membership preserves filter order and deduplicates array keys', () => {
    const mo = new MongoObject({ items: [{ child: 1 }, { child: 2 }], keep: 3 })
    const checked: string[] = []
    mo.filterGenericKeys((key) => {
      checked.push(key)
      return key !== 'items.$.child'
    })
    assert.deepStrictEqual(checked, ['items', 'items.$', 'items.$.child', 'keep'])
    assert.deepStrictEqual(mo.getObject(), { items: [{}, {}], keep: 3 })
    mo.removeGenericKeys(['keep', 'items.$', 'keep'])
    mo.removeArrayItems()
    assert.deepStrictEqual(mo.getObject(), { items: [] })
  })
})
