import expect from 'expect';
import MongoObject from './mongo-object';

describe('MongoObject', () => {
  it('round trip', () => {
    // Helper Functions
    function passthru(doc) {
      const mDoc = new MongoObject(doc);
      return mDoc.getObject();
    }

    function rt(o) {
      expect(passthru(o)).toEqual(o);
    }

    // Round Trip Tests
    rt({});
    rt({ a: 1 });
    rt({ a: 'Test' });
    rt({ a: new Date() });
    rt({ a: [] });
    rt({ a: {} });
    rt({ a: [1, 2] });
    rt({ a: ['Test1', 'Test2'] });
    rt({ a: [new Date(), new Date()] });
    rt({ a: { b: 1 } });
    rt({ a: { b: 'Test' } });
    rt({ a: { b: new Date() } });
    rt({ a: { b: [] } });
    rt({ a: { b: {} } });
    rt({ a: { b: [1, 2] } });
    rt({ a: { b: ['Test1', 'Test2'] } });
    rt({ a: { b: [new Date(), new Date()] } });
    rt({ a: { b: [{ c: 1 }, { c: 2 }] } });
    rt({ a: { b: [{ c: 'Test1' }, { c: 'Test2' }] } });
    rt({ a: { b: [{ c: new Date() }, { c: new Date() }] } });
  });

  it('typed arrays', () => {
    const mo = new MongoObject({ foo: new Uint8Array(10) });
    expect(mo._affectedKeys['foo.0']).toEqual(undefined);
  });

  it('flat', () => {
    // Helper Functions
    function flat(doc, opts) {
      const mDoc = new MongoObject(doc);
      return mDoc.getFlatObject(opts);
    }

    function testFlat(o, exp, opts) {
      expect(flat(o, opts)).toEqual(exp);
    }

    // Flatten Tests
    const testDate = new Date();
    testFlat({}, {});
    testFlat({ a: 1 }, { a: 1 });
    testFlat({ a: 'Test' }, { a: 'Test' });
    testFlat({ a: testDate }, { a: testDate });
    testFlat({ a: [] }, { a: [] });
    testFlat({ a: {} }, { a: {} });
    testFlat({ a: [1, 2] }, { 'a.0': 1, 'a.1': 2 });
    testFlat({ a: [1, 2] }, { a: [1, 2] }, { keepArrays: true });
    testFlat({ a: ['Test1', 'Test2'] }, { 'a.0': 'Test1', 'a.1': 'Test2' });
    testFlat({ a: ['Test1', 'Test2'] }, { a: ['Test1', 'Test2'] }, { keepArrays: true });
    testFlat({ a: [testDate, testDate] }, { 'a.0': testDate, 'a.1': testDate });
    testFlat({ a: [testDate, testDate] }, { a: [testDate, testDate] }, { keepArrays: true });
    testFlat({ a: { b: 1 } }, { 'a.b': 1 });
    testFlat({ a: { b: 'Test' } }, { 'a.b': 'Test' });
    testFlat({ a: { b: testDate } }, { 'a.b': testDate });
    testFlat({ a: { b: [] } }, { 'a.b': [] });
    testFlat({ a: { b: {} } }, { 'a.b': {} });
    testFlat({ a: { b: [1, 2] } }, { 'a.b.0': 1, 'a.b.1': 2 });
    testFlat({ a: { b: [1, 2] } }, { 'a.b': [1, 2] }, { keepArrays: true });
    testFlat({ a: { b: ['Test1', 'Test2'] } }, { 'a.b.0': 'Test1', 'a.b.1': 'Test2' });
    testFlat({ a: { b: ['Test1', 'Test2'] } }, { 'a.b': ['Test1', 'Test2'] }, { keepArrays: true });
    testFlat({ a: { b: [testDate, testDate] } }, { 'a.b.0': testDate, 'a.b.1': testDate });
    testFlat({ a: { b: [testDate, testDate] } }, { 'a.b': [testDate, testDate] }, { keepArrays: true });
    testFlat({ a: { b: [{ c: 1 }, { c: 2 }] } }, { 'a.b.0.c': 1, 'a.b.1.c': 2 });
    testFlat({ a: { b: [{ c: 1 }, { c: 2 }] } }, { 'a.b': [{ c: 1 }, { c: 2 }] }, { keepArrays: true });
    testFlat({ a: { b: [{ c: 'Test1' }, { c: 'Test2' }] } }, { 'a.b.0.c': 'Test1', 'a.b.1.c': 'Test2' });
    testFlat({ a: { b: [{ c: 'Test1' }, { c: 'Test2' }] } }, { 'a.b': [{ c: 'Test1' }, { c: 'Test2' }] }, { keepArrays: true });
    testFlat({ a: { b: [{ c: testDate }, { c: testDate }] } }, { 'a.b.0.c': testDate, 'a.b.1.c': testDate });
    testFlat({ a: { b: [{ c: testDate }, { c: testDate }] } }, { 'a.b': [{ c: testDate }, { c: testDate }] }, { keepArrays: true });
  });

  describe('removeValueForPosition', () => {
    // Helper Function
    function testRemove(o, exp, pos, traverseObject) {
      const mDoc = new MongoObject(o);
      mDoc.removeValueForPosition(pos, traverseObject);
      expect(mDoc.getObject()).toEqual(exp);
    }

    it('should remove values for mongo modifiers', () => {
      // correctly removed
      testRemove({
        foo: 'bar',
      }, {}, 'foo');

      // correctly not removed
      testRemove({
        foo: 'bar',
      }, {
        foo: 'bar',
      }, 'fooBar');

      // all descendents are removed, too
      testRemove({
        foo: {
          bar: 'foobar',
        },
      }, {}, 'foo');

      // but not siblings
      testRemove({
        foo: {
          bar: 'foobar',
          foobar: 1,
        },
      }, {
        foo: {
          bar: 'foobar',
        },
      }, 'foo[foobar]');
    });

    it('should remove values for plain objects', () => {
      testRemove({
        foo: {
          bar: [
            {
              foobar: 1,
            },
          ],
        },
      }, {
        foo: {
          bar: [
            '______MONGO_OBJECT_REMOVED______',
          ],
        },
      }, 'foo.bar[0]', true);
    });
  });

  it('getValueForPosition', () => {
    // Helper Function
    function testGetVal(o, pos, exp, traverseObject) {
      const mDoc = new MongoObject(o);
      expect(mDoc.getValueForPosition(pos, traverseObject)).toEqual(exp);
    }

    testGetVal({ $pull: { foo: 'bar' } }, '$pull', { foo: 'bar' });

    testGetVal({ $pull: { foo: 'bar' } }, '$pull[foo]', 'bar');

    testGetVal({ foo: ['bar'] }, 'foo', ['bar']);

    testGetVal({ foo: ['bar'] }, 'foo[0]', 'bar');

    testGetVal({ foo: [{ a: 1 }, { a: 2 }] }, 'foo', [{ a: 1 }, { a: 2 }]);

    testGetVal({ foo: [{ a: 1 }, { a: 2 }] }, 'foo[1]', { a: 2 });

    testGetVal({ foo: [{ a: 1 }, { a: 2 }] }, 'foo[1][a]', 2);

    testGetVal({ foo: { bar: { baz: [{ a: 1 }, { a: 2 }] } } }, 'foo.bar.baz[1][a]', 2, true);
  });

  it('getInfoForKey', () => {
    // Helper Function
    function testGetInfo(o, key, exp) {
      const mDoc = new MongoObject(o);
      expect(mDoc.getInfoForKey(key)).toEqual(exp);
    }

    testGetInfo({ $set: { foo: 'bar' } }, 'foo', { value: 'bar', operator: '$set' });

    testGetInfo({ $set: { 'foo.bar': 1 } }, 'foo.bar', { value: 1, operator: '$set' });

    testGetInfo({ $set: { 'foo.bar': 1 } }, '$set', undefined); // Not valid

    testGetInfo({ $set: { 'foo.bar.0': 1 } }, 'foo.bar.0', { value: 1, operator: '$set' });

    testGetInfo({ $pull: { foo: 'bar' } }, 'foo', { value: 'bar', operator: '$pull' });

    testGetInfo({ foo: ['bar'] }, 'foo', { value: ['bar'], operator: null });

    testGetInfo({ foo: ['bar'] }, 'foo.0', { value: 'bar', operator: null });

    testGetInfo({ foo: [{ a: 1 }, { a: 2 }] }, 'foo.1.a', { value: 2, operator: null });

    testGetInfo({ foo: [{ a: 1 }, { a: 2 }] }, 'foo.1', { value: { a: 2 }, operator: null });
  });

  it('_keyToPosition', () => {
    // Helper Function
    function convert(key, wrapAll, exp) {
      const pos = MongoObject._keyToPosition(key, wrapAll);
      expect(pos).toEqual(exp);
    }

    convert('foo', false, 'foo');
    convert('foo', true, '[foo]');
    convert('foo.bar', false, 'foo[bar]');
    convert('foo.bar', true, '[foo][bar]');
    convert('foo.bar.0', false, 'foo[bar][0]');
    convert('foo.bar.0', true, '[foo][bar][0]');
  });

  it('makeKeyGeneric', () => {
    const generic = MongoObject.makeKeyGeneric('foo.0.0.ab.c.123.4square.d.67e.f.g.1');
    expect(generic).toEqual('foo.$.$.ab.c.$.4square.d.67e.f.g.$');
  });

  it('cleanNulls', () => {
    const date = new Date();

    const cleaned = MongoObject.cleanNulls({
      a: void 0,
      b: undefined,
      c: null,
      d: '',
      e: 'keep me',
      f: {
        a: void 0,
        b: undefined,
        c: null,
        d: '',
        e: 'keep me',
      },
      g: {
        a: null,
      },
      h: {
        a: date,
      },
    });

    expect(cleaned).toEqual({ e: 'keep me', f: { e: 'keep me' }, h: { a: date } });
  });

  it('reportNulls', () => {
    const report = MongoObject.reportNulls({
      a: void 0,
      b: undefined,
      c: null,
      d: '',
      e: 'keep me',
    });
    expect(report).toEqual({
      a: '',
      b: '',
      c: '',
      d: '',
    });
  });

  it('docToModifier', () => {
    const date = new Date();

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
              d: null, // make sure that null, empty, etc. don't end up in $unset when under an array
            },
          },
        ],
        e: [1, 2],
      },
      e: null,
      f: '',
      g: void 0, // undefined props are removed
    };

    // Test 1 w/ keepArrays, w/ keepEmptyStrings
    let mod = MongoObject.docToModifier(testObj, { keepArrays: true, keepEmptyStrings: true });
    expect(mod).toEqual({
      $set: {
        a: 1,
        b: 'foo',
        c: date,
        'd.a': 1,
        'd.b': 'foo',
        'd.c': date,
        'd.d': [// array of objects should remain array
          {
            a: 1,
            b: 'foo',
            c: date,
            d: {
              a: 1,
              b: 'foo',
              c: date,

              // null should have been removed, too
            },
          },
        ],
        'd.e': [1, 2], // array of non-objects should remain array
        f: '', // empty string should be set rather than unset
      },
      $unset: {
        e: '',
      },
    });

    // Test 2 w/ keepArrays, w/o keepEmptyStrings
    mod = MongoObject.docToModifier(testObj, { keepArrays: true, keepEmptyStrings: false });
    expect(mod).toEqual({
      $set: {
        a: 1,
        b: 'foo',
        c: date,
        'd.a': 1,
        'd.b': 'foo',
        'd.c': date,
        'd.d': [// array of objects should remain array
          {
            a: 1,
            b: 'foo',
            c: date,
            d: {
              a: 1,
              b: 'foo',
              c: date,

              // null should have been removed, too
            },
          },
        ],
        'd.e': [1, 2], // array of non-objects should remain array
      },
      $unset: {
        e: '',
        f: '',
      },
    });

    // Test 3 w/o keepArrays, w/ keepEmptyStrings
    mod = MongoObject.docToModifier(testObj, { keepArrays: false, keepEmptyStrings: true });
    expect(mod).toEqual({
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
        f: '',
      },
      $unset: {
        'd.d.0.d.d': '',
        e: '',
      },
    });

    // Test 4 w/o keepArrays, w/o keepEmptyStrings
    mod = MongoObject.docToModifier(testObj, { keepArrays: false, keepEmptyStrings: false });
    expect(mod).toEqual({
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
      },
      $unset: {
        'd.d.0.d.d': '',
        e: '',
        f: '',
      },
    });
  });

  it('expandObj', () => {
    function testExpandObj(val, exp) {
      const mod = MongoObject.expandObj(val);
      expect(mod).toEqual(exp);
    }

    testExpandObj({}, {});
    testExpandObj({ foo: 'bar' }, { foo: 'bar' });
    testExpandObj({ foo: 'bar', baz: 1 }, { foo: 'bar', baz: 1 });
    testExpandObj({
      'foo.bar': 'baz',
      baz: 1,
    }, {
      foo: { bar: 'baz' },
      baz: 1,
    });
    testExpandObj({
      'foo.bar.0': 'foo',
      'foo.bar.1': 'baz',
      baz: 1,
    }, {
      foo: { bar: ['foo', 'baz'] },
      baz: 1,
    });
    testExpandObj({
      'foo.bar.1': 'baz',
      baz: 1,
    }, {
      foo: { bar: [, 'baz'] }, // eslint-disable-line no-sparse-arrays
      baz: 1,
    });
    testExpandObj({
      'foo.bar.1.bam': 'baz',
      baz: 1,
    }, {
      foo: { bar: [, { bam: 'baz' }] }, // eslint-disable-line no-sparse-arrays
      baz: 1,
    });
    testExpandObj({
      'foo.bar.0': null,
      'foo.bar.1.bam': 'baz',
      baz: 1,
    }, {
      foo: { bar: [null, { bam: 'baz' }] },
      baz: 1,
    });
    testExpandObj({
      'foo.bar.0': 'baz',
      'foo.bar.1.bam': 'baz',
      baz: 1,
    }, {
      foo: { bar: ['baz', { bam: 'baz' }] },
      baz: 1,
    });
    testExpandObj({
      'foo.bar.0': 'baz',
      'foo.bar.1.bam': 'baz',
      'foo.bar.1.boo': 'foo',
      baz: 1,
    }, {
      foo: { bar: ['baz', { bam: 'baz', boo: 'foo' }] },
      baz: 1,
    });
    testExpandObj({
      'foo.0': null,
      'foo.1.bar': 'baz',
      baz: 1,
    }, {
      foo: [null, { bar: 'baz' }],
      baz: 1,
    });
    testExpandObj({
      'foo.0': null,
      'foo.1.bar': null,
      baz: 1,
    }, {
      foo: [null, { bar: null }],
      baz: 1,
    });
  });

  describe('setValueForPosition', () => {
    it('should set nested values based on array ([]) and dot (.) notation paths', () => {
      const position = 'nested.doubleNested[0][tripleNested.integer]';
      const value = 10;
      const mongoObject = new MongoObject({
        nested: {
          doubleNested: [
            {
              tripleNested: {},
            },
          ],
        },
      });
      mongoObject.setValueForPosition(position, value, true);
      expect(mongoObject.getObject()).toEqual({
        nested: {
          doubleNested: [
            {
              tripleNested: {
                integer: 10,
              },
            },
          ],
        },
      });
    });
  });
});
