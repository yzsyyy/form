import set from 'lodash/set';
import createFormField, { isFormField } from './createFormField';
import {
  hasRules,
  flattenFields,
  getErrorStrs,
  startsWith,
} from './utils';

function partOf(a, b) {
  return b.indexOf(a) === 0 && ['.', '['].indexOf(b[a.length]) !== -1;
}

/**
 * 内部压平字段
 * @notes yzsexe
 * @param {*} fields 
 * @returns 
 */
function internalFlattenFields(fields) {
  return flattenFields(
    fields,
    (_, node) => isFormField(node),
    'You must wrap field data with `createFormField`.'
  );
}

class FieldsStore {
  constructor(fields) {
    // 所有字段
    this.fields = internalFlattenFields(fields);

    // 字段元
    this.fieldsMeta = {};
  }

  /**
   * 更新字段
   * @param {*} fields 
   */
  updateFields(fields) {
    this.fields = internalFlattenFields(fields);
  }

  /**
   * 压平已注册的字段
   * @notes yzsexe
   * @param {*} fields 
   * @returns 
   */
  flattenRegisteredFields(fields) {
    // 有效的字段名数组
    const validFieldsName = this.getAllFieldsName();
    return flattenFields(
      fields,
      path => validFieldsName.indexOf(path) >= 0,
      'You cannot set a form field before rendering a field associated with the value.'
    );
  }

  setFieldsInitialValue = (initialValues) => {
    const flattenedInitialValues = this.flattenRegisteredFields(initialValues);
    const fieldsMeta = this.fieldsMeta;
    Object.keys(flattenedInitialValues).forEach(name => {
      if (fieldsMeta[name]) {
        this.setFieldMeta(name, {
          ...this.getFieldMeta(name),
          initialValue: flattenedInitialValues[name],
        });
      }
    });
  }

  setFields(fields) {
    const fieldsMeta = this.fieldsMeta;
    const nowFields = {
      ...this.fields,
      ...fields,
    };
    const nowValues = {};
    Object.keys(fieldsMeta)
      .forEach((f) => {
        nowValues[f] = this.getValueFromFields(f, nowFields);
      });
    Object.keys(nowValues).forEach((f) => {
      const value = nowValues[f];
      const fieldMeta = this.getFieldMeta(f);
      if (fieldMeta && fieldMeta.normalize) {
        const nowValue =
                fieldMeta.normalize(value, this.getValueFromFields(f, this.fields), nowValues);
        if (nowValue !== value) {
          nowFields[f] = {
            ...nowFields[f],
            value: nowValue,
          };
        }
      }
    });
    this.fields = nowFields;
  }

  /**
   * 重置n组输入控件的值，如不传入参数，则重置所有组件, 并返回
   * @notes yzs
   * @param { string[] } ns 需要重置的字段名数组
   * @returns { { [propName]: {} } }
   */
  resetFields(ns) {
    const { fields } = this;
    const names = ns ?
      this.getValidFieldsFullName(ns) :
      this.getAllFieldsName();
    return names.reduce((acc, name) => {
      const field = fields[name];
      if (field && 'value' in field) {
        acc[name] = {};
      }
      return acc;
    }, {});
  }

  /**
   * 更新设置字段元的某个字段的元数据
   * @param {*} name 
   * @param {*} meta 
   */
  setFieldMeta(name, meta) {
    this.fieldsMeta[name] = meta;
  }

  /**
   * 将所有字段标识dirty = true
   * // todo: 具体作用等看完其他源码再来补充
   * @notes yzs
   */
  setFieldsAsDirty() {
    Object.keys(this.fields).forEach((name) => {
      const field = this.fields[name];
      const fieldMeta = this.fieldsMeta[name];
      if (field && fieldMeta && hasRules(fieldMeta.validate)) {
        this.fields[name] = {
          ...field,
          dirty: true,
        };
      }
    });
  }

  /**
   * 获取某个字段的字段元
   * @param {String} name 
   * @returns {Object}
   */
  getFieldMeta(name) {
    this.fieldsMeta[name] = this.fieldsMeta[name] || {};
    return this.fieldsMeta[name];
  }

  /**
   * 从所有字段数据(this.fields)中获取对应name的值
   * @notes yzs
   * @param {String} name 
   * @param {Object} fields 
   * @returns {*} value or initialValue
   */
  getValueFromFields(name, fields) {
    const field = fields[name];
    if (field && 'value' in field) {
      return field.value;
    }
    const fieldMeta = this.getFieldMeta(name);
    return fieldMeta && fieldMeta.initialValue;
  }

  /**
   * 获取所有值
   * // tag: 该方法reduce的用法可借鉴
   * @notes yzs
   * @returns 
   */
  getAllValues = () => {
    const { fieldsMeta, fields } = this;
    return Object.keys(fieldsMeta)
      .reduce((acc, name) => set(acc, name, this.getValueFromFields(name, fields)), {});
  }

  /**
   * 获取所有有效字段名
   * @notes yzs
   * @returns { string[] } string[]. eg: ["abc.a.c", "d"]
   */
  getValidFieldsName() {
    const { fieldsMeta } = this;

    // fieldMeta元对象中某个字段对象的hidden: 在验证或获取字段时忽略当前字段, 默认是false, 不忽略
    return fieldsMeta ?
      Object.keys(fieldsMeta).filter(name => !this.getFieldMeta(name).hidden) :
      [];
  }

  /**
   * 返回所有字段的key数组
   * @returns 
   */
  getAllFieldsName() {
    const { fieldsMeta } = this;
    return fieldsMeta ? Object.keys(fieldsMeta) : [];
  }

  /**
   * 获取所有有效字段的全名
   * @param {String | String[]} maybePartialName 可能是不完整的字段名
   * @returns { String[] } string[]
   */
  getValidFieldsFullName(maybePartialName) {
    const maybePartialNames = Array.isArray(maybePartialName) ?
      maybePartialName : [maybePartialName];
    return this.getValidFieldsName()
      .filter(fullName => maybePartialNames.some(partialName => (
        fullName === partialName || (
          startsWith(fullName, partialName) &&
          ['.', '['].indexOf(fullName[partialName.length]) >= 0
        )
      )));
  }

  /**
   * 根据[控件字段名]获取组件的props值
   * @notes yzsexe
   * @param {*} fieldMeta 
   * @returns 
   */
  getFieldValuePropValue(fieldMeta) {
    const { name, getValueProps, valuePropName } = fieldMeta;
    const field = this.getField(name);
    const fieldValue = 'value' in field ?
      field.value : fieldMeta.initialValue;
    if (getValueProps) {
      return getValueProps(fieldValue);
    }
    return { [valuePropName]: fieldValue };
  }

  /**
   * 根据[控件字段名]获取字段相关数据
   * @notes yzsexe
   * @param {*} name 
   * @returns 
   */
  getField(name) {
    return {
      ...this.fields[name],
      name,
    };
  }

  getNotCollectedFields() {
    const fieldsName = this.getValidFieldsName();
    return fieldsName
      .filter(name => !this.fields[name])
      .map(name => ({
        name,
        dirty: false,
        value: this.getFieldMeta(name).initialValue,
      }))
      .reduce((acc, field) => set(acc, field.name, createFormField(field)), {});
  }

  getNestedAllFields() {
    return Object.keys(this.fields)
      .reduce(
        (acc, name) => set(acc, name, createFormField(this.fields[name])),
        this.getNotCollectedFields()
      );
  }

  getFieldMember(name, member) {
    return this.getField(name)[member];
  }

  getNestedFields(names, getter) {
    const fields = names || this.getValidFieldsName();
    return fields.reduce((acc, f) => set(acc, f, getter(f)), {});
  }

  /**
   * // 获取嵌套的字段对象
   * @param {String | String[]} name 可能是不完整的字段名
   * @param {*} getter 
   * @returns 
   */
  getNestedField(name, getter) {
    // 获取所有有效字段的全名
    const fullNames = this.getValidFieldsFullName(name);
    if (
      fullNames.length === 0 || // Not registered
        (fullNames.length === 1 && fullNames[0] === name) // Name already is full name.
    ) {
      return getter(name);
    }
    const isArrayValue = fullNames[0][name.length] === '[';
    const suffixNameStartIndex = isArrayValue ? name.length : name.length + 1;
    return fullNames
      .reduce(
        (acc, fullName) => set(
          acc,
          fullName.slice(suffixNameStartIndex),
          getter(fullName)
        ),
        isArrayValue ? [] : {}
      );
  }

  getFieldsValue = (names) => {
    return this.getNestedFields(names, this.getFieldValue);
  }

  /**
   * 获取控件字段名对应的值
   * @notes yzs
   * @param {String | String[]} name 可能是不完整的字段名
   * @returns {*} value or initialValue
   */
  getFieldValue = (name) => {
    const { fields } = this;
    return this.getNestedField(name, (fullName) => this.getValueFromFields(fullName, fields));
  }

  getFieldsError = (names) => {
    return this.getNestedFields(names, this.getFieldError);
  }

  getFieldError = (name) => {
    return this.getNestedField(
      name,
      (fullName) => getErrorStrs(this.getFieldMember(fullName, 'errors'))
    );
  }

  isFieldValidating = (name) => {
    return this.getFieldMember(name, 'validating');
  }

  isFieldsValidating = (ns) => {
    const names = ns || this.getValidFieldsName();
    return names.some((n) => this.isFieldValidating(n));
  }

  isFieldTouched = (name) => {
    return this.getFieldMember(name, 'touched');
  }

  isFieldsTouched = (ns) => {
    const names = ns || this.getValidFieldsName();
    return names.some((n) => this.isFieldTouched(n));
  }

  /**
   * 判断是否是有效的(嵌套)字段名
   * @notes yzsexe
   * @param {*} name 
   * @returns 
   */
  // @private
  // BG: `a` and `a.b` cannot be use in the same form
  isValidNestedFieldName(name) {
    const names = this.getAllFieldsName();
    return names.every(n => !partOf(n, name) && !partOf(name, n));
  }

  /**
   * 清空对应字段名的字段数据、字段元的对应元数据
   * @param {*} name 
   */
  clearField(name) {
    delete this.fields[name];
    delete this.fieldsMeta[name];
  }
}

export default function createFieldsStore(fields) {
  return new FieldsStore(fields);
}
