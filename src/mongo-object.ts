import {
  appendAffectedKey,
  cleanNulls,
  each,
  expandKey,
  extractOp,
  genericKeyAffectsOtherGenericKey,
  isBasicObject,
  isEmpty,
  isObject,
  keyToPosition,
  makeKeyGeneric,
  reportNulls
} from './util.js'

const REMOVED_MARKER = '______MONGO_OBJECT_REMOVED______'

export type MongoDoc = Record<string, unknown>

export interface GetFlatObjectOptions {
  /**
   * Pass `true` to keep entire arrays
   */
  keepArrays?: boolean
}

interface DocToModifierOptions {
  /**
   * Pass `true` to $set entire arrays. Otherwise the modifier will $set individual array items.
   */
  keepArrays?: boolean
  /**
   * Pass `true` to keep empty strings in the $set. Otherwise $unset them.
   */
  keepEmptyStrings?: boolean
}

interface PositionInfo {
  key: string
  operator: string | null
  position: string
}

export interface KeyInfo {
  operator: string | null
  value: any
}

interface MongoUpdateDoc {
  $each?: Record<string, any>
  $set?: Record<string, any>
  $unset?: Record<string, any>
}

export default class MongoObject {
  private _affectedKeys: Record<string, string | null | undefined> = {}

  private _arrayItemPositions: string[] = []

  private readonly _blackboxKeys: string[] = []

  private _genericAffectedKeys: Record<string, string | null> = {}

  private readonly _obj: MongoDoc

  private _objectPositions: string[] = []

  private _parentPositions: string[] = []

  private _positionsByGenericKey: Record<string, PositionInfo[]> = {}

  private _positionsInsideArrays: string[] = []

  private _positionsThatCreateGenericKey: Record<string, PositionInfo[]> = {}

  /*
   * @constructor
   * @param obj
   * @param blackboxKeys A list of the names of keys that shouldn't be traversed
   * @returns {undefined}
   *
   * Creates a new MongoObject instance. The object passed as the first argument
   * will be modified in place by calls to instance methods. Also, immediately
   * upon creation of the instance, the object will have any `undefined` keys
   * removed recursively.
   */
  constructor (obj: MongoDoc, blackboxKeys: string[] = []) {
    this._obj = obj
    this._blackboxKeys = blackboxKeys
    this._reParseObj()
  }

  _reParseObj (): void {
    const blackboxKeys = this._blackboxKeys

    this._affectedKeys = {}
    this._genericAffectedKeys = {}
    this._positionsByGenericKey = {}
    this._positionsThatCreateGenericKey = {}
    this._parentPositions = []
    this._positionsInsideArrays = []
    this._objectPositions = []
    this._arrayItemPositions = []

    function parseObj (
      self: MongoObject,
      val: unknown,
      currentPosition?: string,
      affectedKey?: string | null,
      operator?: string,
      adjusted?: boolean,
      isWithinArray?: boolean
    ): void {
      // Adjust for first-level modifier operators
      if (operator == null && affectedKey?.substring(0, 1) === '$') {
        operator = affectedKey
        affectedKey = null
      }

      let affectedKeyIsBlackBox = false
      let stop = false
      if (affectedKey != null) {
        // Adjust for $push and $addToSet and $pull and $pop
        if (adjusted !== true) {
          if (
            operator === '$push' ||
            operator === '$addToSet' ||
            operator === '$pop'
          ) {
            // Adjust for $each
            // We can simply jump forward and pretend like the $each array
            // is the array for the field. This has the added benefit of
            // skipping past any $slice, which we also don't care about.
            if (isBasicObject(val) && '$each' in (val as MongoUpdateDoc)) {
              val = (val as MongoUpdateDoc).$each
              // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
              currentPosition = `${currentPosition}[$each]`
            } else {
              affectedKey = `${affectedKey}.0`
            }

            adjusted = true
          } else if (operator === '$pull') {
            affectedKey = `${affectedKey}.0`
            if (isBasicObject(val)) {
              stop = true
            }

            adjusted = true
          }
        }

        // Make generic key
        const affectedKeyGeneric = makeKeyGeneric(affectedKey)
        if (affectedKeyGeneric === null) throw new Error(`Failed to get generic key for key "${affectedKey}"`)

        // Determine whether affected key should be treated as a black box
        affectedKeyIsBlackBox = affectedKeyGeneric !== null &&
          blackboxKeys.includes(affectedKeyGeneric)

        // Mark that this position affects this generic and non-generic key
        if (currentPosition != null) {
          self._affectedKeys[currentPosition] = affectedKey
          self._genericAffectedKeys[currentPosition] = affectedKeyGeneric

          const positionInfo: PositionInfo = {
            key: affectedKey,
            operator: operator ?? null,
            position: currentPosition
          }

          if (self._positionsByGenericKey[affectedKeyGeneric] == null) self._positionsByGenericKey[affectedKeyGeneric] = []
          self._positionsByGenericKey[affectedKeyGeneric].push(positionInfo)

          // Operators other than $unset will cause ancestor object keys to
          // be auto-created.
          if (operator != null && operator !== '$unset') {
            MongoObject.objectsThatGenericKeyWillCreate(
              affectedKeyGeneric
            ).forEach((objGenericKey) => {
              if (self._positionsThatCreateGenericKey[objGenericKey] === undefined) {
                self._positionsThatCreateGenericKey[objGenericKey] = []
              }
              self._positionsThatCreateGenericKey[objGenericKey].push(
                positionInfo
              )
            })
          }

          // If we're within an array, mark this position so we can omit it from flat docs
          if (isWithinArray === true) self._positionsInsideArrays.push(currentPosition)
        }
      }

      if (stop) return

      // Loop through arrays
      if (Array.isArray(val) && val.length > 0) {
        if (currentPosition != null) {
          // Mark positions with arrays that should be ignored when we want endpoints only
          self._parentPositions.push(currentPosition)
        }

        // Loop
        val.forEach((v, i) => {
          if (currentPosition != null) self._arrayItemPositions.push(`${currentPosition}[${i}]`)
          parseObj(
            self,
            v,
            currentPosition != null ? `${currentPosition}[${i}]` : String(i),
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            `${affectedKey}.${i}`,
            operator,
            adjusted,
            true
          )
        })
      } else if (
        (isBasicObject(val) && !affectedKeyIsBlackBox) ||
        currentPosition == null
      ) {
        // Loop through object keys, only for basic objects,
        // but always for the passed-in object, even if it
        // is a custom object.

        if (currentPosition != null && !isEmpty(val)) {
          // Mark positions with objects that should be ignored when we want endpoints only
          self._parentPositions.push(currentPosition)

          // Mark positions with objects that should be left out of flat docs.
          self._objectPositions.push(currentPosition)
        }

        // Loop
        Object.keys(val as Record<string, any>).forEach((k) => {
          const v = (val as Record<string, any>)[k]

          if (v === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete (val as Record<string, any>)[k]
          } else if (k !== '$slice') {
            parseObj(
              self,
              v,
              currentPosition != null ? `${currentPosition}[${k}]` : k,
              appendAffectedKey(affectedKey, k),
              operator,
              adjusted,
              isWithinArray
            )
          }
        })
      }
    }

    parseObj(this, this._obj)
  }

  /**
   * @param func
   * @param [options]
   * @param [options.endPointsOnly=true] - Only call function for endpoints and not for nodes that contain other nodes
   * @returns
   *
   * Runs a function for each endpoint node in the object tree, including all items in every array.
   * The function arguments are
   * (1) the value at this node
   * (2) a string representing the node position
   * (3) the representation of what would be changed in mongo, using mongo dot notation
   * (4) the generic equivalent of argument 3, with '$' instead of numeric pieces
   */
  forEachNode (func: () => void, { endPointsOnly = true } = {}): void {
    if (typeof func !== 'function') throw new Error('filter requires a loop function')

    const updatedValues: Record<string, any> = {}
    Object.keys(this._affectedKeys).forEach((position) => {
      if (endPointsOnly && this._parentPositions.includes(position)) return // Only endpoints
      func.call({
        value: this.getValueForPosition(position),
        isArrayItem: this._arrayItemPositions.includes(position),
        operator: extractOp(position),
        position,
        key: this._affectedKeys[position],
        genericKey: this._genericAffectedKeys[position],
        updateValue: (newVal: any) => {
          updatedValues[position] = newVal
        },
        remove: () => {
          updatedValues[position] = undefined
        }
      })
    })

    // Actually update/remove values as instructed
    Object.keys(updatedValues).forEach((position) => {
      this.setValueForPosition(position, updatedValues[position])
    })
  }

  getValueForPosition (position: string): any {
    const subkeys = position.split('[')
    let current: any = this._obj
    const ln = subkeys.length
    for (let i = 0; i < ln; i++) {
      let subkey = subkeys[i]

      // If the subkey ends in ']', remove the ending
      if (subkey.slice(-1) === ']') subkey = subkey.slice(0, -1)
      current = current[subkey]
      if (!Array.isArray(current) && !isBasicObject(current) && i < ln - 1) return
    }

    if (current === REMOVED_MARKER) return
    return current
  }

  /**
   * @param position
   * @param value
   */
  setValueForPosition (position: string, value: any): void {
    const subkeys = position.split('[')
    let current: any = this._obj
    const ln = subkeys.length

    let createdObjectsOrArrays = false
    let affectedKey: string | null | undefined = ''

    for (let i = 0; i < ln; i++) {
      let subkey = subkeys[i]

      // If the subkey ends in "]", remove the ending
      if (subkey.slice(-1) === ']') subkey = subkey.slice(0, -1)

      // We don't store modifiers
      if (subkey.length > 0 && subkey.substring(0, 1) !== '$') {
        affectedKey = appendAffectedKey(affectedKey, subkey)
      }

      // If we've reached the key in the object tree that needs setting or
      // deleting, do it.
      if (i === ln - 1) {
        // If value is undefined, delete the property
        if (value === undefined) {
          if (Array.isArray(current)) {
            // We can't just delete it because indexes in the position strings will be off
            // We will mark it uniquely and then parse this elsewhere
            current[Number(subkey)] = REMOVED_MARKER
          } else {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete current[subkey]
          }
        } else {
          current[subkey] = value
        }

        this._affectedKeys[position] = affectedKey
      } else {
        // Otherwise attempt to keep moving deeper into the object.
        // If we're setting (as opposed to deleting) a key and we hit a place
        // in the ancestor chain where the keys are not yet created, create them.
        if (current[subkey] === undefined && value !== undefined) {
          // See if the next piece is a number
          const nextPiece = subkeys[i + 1]
          current[subkey] = Number.isNaN(parseInt(nextPiece, 10)) ? {} : []
          createdObjectsOrArrays = true
        }

        // Move deeper into the object
        current = current[subkey]

        // If we can go no further, then quit
        if (!Array.isArray(current) && !isBasicObject(current) && i < ln - 1) return
      }
    }

    // If there are now new arrays or objects in the main object, we need to reparse it
    if (
      createdObjectsOrArrays ||
      Array.isArray(value) ||
      isBasicObject(value)
    ) {
      this._reParseObj()
    }
  }

  removeValueForPosition (position: string): void {
    this.setValueForPosition(position, undefined)
  }

  getKeyForPosition (position: string): string | null | undefined {
    return this._affectedKeys[position]
  }

  getGenericKeyForPosition (position: string): string | null | undefined {
    return this._genericAffectedKeys[position]
  }

  /**
   * @param key Non-generic key
   * @returns The value and operator of the requested non-generic key.
   *   Example: {value: 1, operator: "$pull"}
   */
  getInfoForKey (key: string): KeyInfo | undefined {
    // Get the info
    const position = this.getPositionForKey(key)
    if (position !== undefined) {
      return {
        value: this.getValueForPosition(position),
        operator: extractOp(position)
      }
    }

    // If we haven't returned yet, check to see if there is an array value
    // corresponding to this key
    // We find the first item within the array, strip the last piece off the
    // position string, and then return whatever is at that new position in
    // the original object.
    const positions = this.getPositionsForGenericKey(`${key}.$`)
    for (let index = 0; index < positions.length; index++) {
      const pos = positions[index]
      let value = this.getValueForPosition(pos)
      if (value === undefined) {
        const parentPosition = pos.slice(0, pos.lastIndexOf('['))
        value = this.getValueForPosition(parentPosition)
      }

      if (value !== undefined) {
        return {
          value,
          operator: extractOp(pos)
        }
      }
    }
  }

  /**
   * @method MongoObject.getPositionForKey
   * @param {String} key - Non-generic key
   * @returns The position string for the place in the object that
   *   affects the requested non-generic key.
   *   Example: 'foo[bar][0]'
   */
  getPositionForKey (key: string): string | undefined {
    const positions = Object.getOwnPropertyNames(this._affectedKeys)
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index]
      // We return the first one we find. While it's
      // possible that multiple update operators could
      // affect the same non-generic key, we'll assume that's not the case.
      if (this._affectedKeys[position] === key) return position
    }
  }

  /**
   * @param genericKey Generic key
   * @returns An array of position strings for the places in the object that
   *   affect the requested generic key.
   *   Example: ['foo[bar][0]']
   */
  getPositionsForGenericKey (genericKey: string): string[] {
    return this.getPositionsInfoForGenericKey(genericKey).map(
      (p) => p.position
    )
  }

  /**
   * @param genericKey Generic key
   * @returns An array of position info for the places in the object that
   *   affect the requested generic key.
   */
  getPositionsInfoForGenericKey (genericKey: string): PositionInfo[] {
    let positions = this._positionsByGenericKey[genericKey]
    if (positions == null || positions.length === 0) positions = this._positionsByGenericKey[`${genericKey}.$`]
    if (positions == null || positions.length === 0) positions = []
    return positions.map((info) => ({
      value: this.getValueForPosition(info.position),
      ...info
    }))
  }

  getPositionsThatCreateGenericKey (genericKey: string): PositionInfo[] {
    return this._positionsThatCreateGenericKey[genericKey] ?? []
  }

  /**
   * @deprecated Use getInfoForKey
   * @param {String} key - Non-generic key
   * @returns The value of the requested non-generic key
   */
  getValueForKey (key: string): any {
    const position = this.getPositionForKey(key)
    if (position != null) return this.getValueForPosition(position)
  }

  /**
   * Adds `key` with value `val` under operator `op` to the source object.
   *
   * @param key Key to set
   * @param val Value to give this key
   * @param op Operator under which to set it, or `null` for a non-modifier object
   * @returns
   */
  addKey (key: string, val: any, op: string | null): void {
    const position = op != null ? `${op}[${key}]` : keyToPosition(key)
    this.setValueForPosition(position, val)
  }

  /**
   * Removes anything that affects any of the generic keys in the list
   */
  removeGenericKeys (keys: string[]): void {
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach(
      (position) => {
        const genericKey = this._genericAffectedKeys[position]
        if (genericKey !== null && keys.includes(genericKey)) {
          this.removeValueForPosition(position)
        }
      }
    )
  }

  /**
   * Removes anything that affects the requested generic key
   */
  removeGenericKey (key: string): void {
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach(
      (position) => {
        if (this._genericAffectedKeys[position] === key) {
          this.removeValueForPosition(position)
        }
      }
    )
  }

  /**
   * Removes anything that affects the requested non-generic key
   */
  removeKey (key: string): void {
    // We don't use getPositionForKey here because we want to be sure to
    // remove for all positions if there are multiple.
    Object.getOwnPropertyNames(this._affectedKeys).forEach((position) => {
      if (this._affectedKeys[position] === key) {
        this.removeValueForPosition(position)
      }
    })
  }

  /**
   * Removes anything that affects any of the non-generic keys in the list
   */
  removeKeys (keys: string[]): void {
    keys.forEach((key) => this.removeKey(key))
  }

  /**
   * Passes all affected keys to a test function, which
   * should return false to remove whatever is affecting that key
   */
  filterGenericKeys (test: (genericKey: string) => boolean): void {
    const checkedKeys: string[] = []
    const keysToRemove: string[] = []
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach(
      (position) => {
        const genericKey = this._genericAffectedKeys[position]
        if (genericKey !== null && !checkedKeys.includes(genericKey)) {
          checkedKeys.push(genericKey)
          if (genericKey != null && !test(genericKey)) {
            keysToRemove.push(genericKey)
          }
        }
      }
    )

    keysToRemove.forEach((key) => this.removeGenericKey(key))
  }

  /**
   * Sets the value for every place in the object that affects
   * the requested non-generic key
   */
  setValueForKey (key: string, val: any): void {
    // We don't use getPositionForKey here because we want to be sure to
    // set the value for all positions if there are multiple.
    Object.getOwnPropertyNames(this._affectedKeys).forEach((position) => {
      if (this._affectedKeys[position] === key) {
        this.setValueForPosition(position, val)
      }
    })
  }

  /**
   * Sets the value for every place in the object that affects
   * the requested generic key
   */
  setValueForGenericKey (key: string, val: any): void {
    // We don't use getPositionForKey here because we want to be sure to
    // set the value for all positions if there are multiple.
    Object.getOwnPropertyNames(this._genericAffectedKeys).forEach(
      (position) => {
        if (this._genericAffectedKeys[position] === key) {
          this.setValueForPosition(position, val)
        }
      }
    )
  }

  removeArrayItems (): void {
    // Traverse and pull out removed array items at this point
    function traverse (obj: any): void {
      each(obj, (val, indexOrProp): undefined => {
        // Move deeper into the object
        const next = obj[indexOrProp]

        // If we can go no further, then quit
        if (isBasicObject(next)) {
          traverse(next)
        } else if (Array.isArray(next)) {
          obj[indexOrProp] = next.filter((item) => item !== REMOVED_MARKER)
          traverse(obj[indexOrProp])
        }

        return undefined
      })
    }

    traverse(this._obj)
  }

  /**
   * Get the source object, potentially modified by other method calls on this
   * MongoObject instance.
   */
  getObject (): MongoDoc {
    return this._obj
  }

  /**
   * Gets a flat object based on the MongoObject instance.
   * In a flat object, the key is the name of the non-generic affectedKey,
   * with mongo dot notation if necessary, and the value is the value for
   * that key.
   *
   * With `keepArrays: true`, we don't flatten within arrays. Currently
   * MongoDB does not see a key such as `a.0.b` and automatically assume
   * an array. Instead it would create an object with key '0' if there
   * wasn't already an array saved as the value of `a`, which is rarely
   * if ever what we actually want. To avoid this confusion, we
   * set entire arrays.
   */
  getFlatObject ({ keepArrays = false }: GetFlatObjectOptions = {}): Record<
  string,
  any
  > {
    const newObj: Record<string, any> = {}
    Object.keys(this._affectedKeys).forEach((position) => {
      const affectedKey = this._affectedKeys[position]
      if (
        typeof affectedKey === 'string' &&
        ((keepArrays &&
          !this._positionsInsideArrays.includes(position) &&
          !this._objectPositions.includes(position)) ||
          (!keepArrays &&
            !this._parentPositions.includes(position)))
      ) {
        newObj[affectedKey] = this.getValueForPosition(position)
      }
    })
    return newObj
  }

  /**
   * @method MongoObject.affectsKey
   * @param key Key to test
   * @returns True if the non-generic key is affected by this object
   */
  affectsKey (key: string): boolean {
    return this.getPositionForKey(key) !== undefined
  }

  /**
   * @method MongoObject.affectsGenericKey
   * @param key Key to test
   * @returns True if the generic key is affected by this object
   */
  affectsGenericKey (key: string): boolean {
    const positions = Object.getOwnPropertyNames(this._genericAffectedKeys)
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index]
      if (this._genericAffectedKeys[position] === key) return true
    }

    return false
  }

  /**
   * @method MongoObject.affectsGenericKeyImplicit
   * @param key Key to test
   * @returns Like affectsGenericKey, but will return true if a child key is affected
   */
  affectsGenericKeyImplicit (key: string): boolean {
    const positions = Object.getOwnPropertyNames(this._genericAffectedKeys)
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index]
      const affectedKey = this._genericAffectedKeys[position]
      if (
        affectedKey !== null &&
        genericKeyAffectsOtherGenericKey(key, affectedKey)
      ) return true
    }

    return false
  }

  /* STATIC */

  private static readonly _keyToPosition = keyToPosition

  public static cleanNulls = cleanNulls

  public static expandKey = expandKey

  public static isBasicObject = isBasicObject

  public static makeKeyGeneric = makeKeyGeneric

  public static reportNulls = reportNulls

  /**
   * This is different from MongoObject.prototype.getKeyForPosition in that
   * this method does not depend on the requested position actually being
   * present in any particular MongoObject.
   *
   * @method MongoObject._positionToKey
   * @param position
   * @returns The key that this position in an object would affect.
   */
  static _positionToKey (position: string): string | null | undefined {
    // XXX Probably a better way to do this, but this is
    // foolproof for now.
    const mDoc = new MongoObject({})
    mDoc.setValueForPosition(position, 1) // Value doesn't matter
    return mDoc.getKeyForPosition(position)
  }

  /**
   * @method MongoObject.docToModifier
   * @public
   * @param doc - An object to be converted into a MongoDB modifier
   * @param [options] Options
   * @returns A MongoDB modifier.
   *
   * Converts an object into a modifier by flattening it, putting keys with
   * null, undefined, and empty string values into `modifier.$unset`, and
   * putting the rest of the keys into `modifier.$set`.
   */
  public static docToModifier (
    doc: any,
    { keepArrays = false, keepEmptyStrings = false }: DocToModifierOptions = {}
  ): any {
    // Flatten doc
    const mDoc = new MongoObject(doc)
    let flatDoc = mDoc.getFlatObject({ keepArrays })

    // Get a list of null, undefined, and empty string values so we can unset them instead
    const nulls = reportNulls(flatDoc, keepEmptyStrings)
    flatDoc = cleanNulls(flatDoc, false, keepEmptyStrings)

    const modifier: MongoUpdateDoc = {}
    if (!isEmpty(flatDoc)) modifier.$set = flatDoc
    if (!isEmpty(nulls)) modifier.$unset = nulls
    return modifier
  }

  static objAffectsKey (obj: any, key: string): boolean {
    const mDoc = new MongoObject(obj)
    return mDoc.affectsKey(key)
  }

  /**
   * @param genericKey Generic key
   * @return Array of other generic keys that would be created by this generic key
   */
  static objectsThatGenericKeyWillCreate (genericKey: string): string[] {
    const objs = []

    do {
      const lastDotPosition = genericKey.lastIndexOf('.')
      genericKey = lastDotPosition === -1 ? '' : genericKey.slice(0, lastDotPosition)
      if (genericKey.length > 0 && !genericKey.endsWith('.$')) objs.push(genericKey)
    } while (genericKey.length > 0)

    return objs
  }

  /**
   * Takes a flat object and returns an expanded version of it.
   */
  static expandObj (doc: Record<string, any>): Record<string, any> {
    const newDoc = {}
    Object.keys(doc).forEach((key) => {
      const val = doc[key]
      const subkeys = key.split('.')
      const subkeylen = subkeys.length
      let current: any = newDoc
      for (let i = 0; i < subkeylen; i++) {
        const subkey = subkeys[i]
        if (
          typeof current[subkey] !== 'undefined' &&
          !isObject(current[subkey])
        ) {
          break // Already set for some reason; leave it alone
        }

        if (i === subkeylen - 1) {
          // Last iteration; time to set the value
          current[subkey] = val
        } else {
          // See if the next piece is a number
          const nextPiece = subkeys[i + 1]
          const nextPieceInt = parseInt(nextPiece, 10)
          if (Number.isNaN(nextPieceInt) && !isObject(current[subkey])) {
            current[subkey] = {}
          } else if (
            !Number.isNaN(nextPieceInt) &&
            !Array.isArray(current[subkey])
          ) {
            current[subkey] = []
          }
        }

        current = current[subkey]
      }
    })
    return newDoc
  }
}
