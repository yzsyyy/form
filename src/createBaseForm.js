/* eslint-disable react/prefer-es6-class */
/* eslint-disable prefer-promise-reject-errors */

import React from 'react';
import createReactClass from 'create-react-class';
import unsafeLifecyclesPolyfill from 'rc-util/lib/unsafeLifecyclesPolyfill';
import AsyncValidator from 'async-validator';
import warning from 'warning';
import get from 'lodash/get';
import set from 'lodash/set';
import eq from 'lodash/eq';
import createFieldsStore from './createFieldsStore';
import {
  argumentContainer,
  identity,
  normalizeValidateRules,
  getValidateTriggers,
  getValueFromEvent,
  hasRules,
  getParams,
  isEmptyObject,
  flattenArray,
  supportRef
} from './utils';
import FieldElemWrapper from './FieldElemWrapper';

const DEFAULT_TRIGGER = 'onChange';

function createBaseForm(option = {}, mixins = []) {
  const {
    validateMessages,
    onFieldsChange,
    // 任一表单域的值发生改变时的回调: (props, changedValues, allValues) => void
    onValuesChange,
    mapProps = identity,
    mapPropsToFields,
    fieldNameProp,
    // 指定getFieldProps的元数据存在哪里: string
    fieldMetaProp,
    // 存储字段数据的位置
    fieldDataProp,
    formPropName = 'form',
    // 单域内字段 id 的前缀
    name: formName,
    // @deprecated
    withRef,
  } = option;

  // 返回一个高阶函数
  return function decorate(WrappedComponent) {
    // 用create-react-class创建一个表单类
    const Form = createReactClass({
      mixins,

      // 初始化state
      getInitialState() {
        const fields = mapPropsToFields && mapPropsToFields(this.props);
        // 创建字段状态机
        this.fieldsStore = createFieldsStore(fields || {});

        // 字段实例的集合
        this.instances = {};
        // 缓存绑定
        this.cachedBind = {};
        // 已清除的字段元的缓存集合
        this.clearedFieldMetaCache = {};

        // 已渲染更新的字段名集合
        this.renderFields = {};

        // 挂载了ref的控件字段名集合
        this.domFields = {};

        // HACK: https://github.com/ant-design/ant-design/issues/6406
        [
          'getFieldsValue',
          'getFieldValue',
          'setFieldsInitialValue',
          'getFieldsError',
          'getFieldError',
          'isFieldValidating',
          'isFieldsValidating',
          'isFieldsTouched',
          'isFieldTouched',
        ].forEach(key => {
          this[key] = (...args) => {
            if (process.env.NODE_ENV !== 'production') {
              warning(
                false,
                'you should not use `ref` on enhanced form, please use `wrappedComponentRef`. ' +
                'See: https://github.com/react-component/form#note-use-wrappedcomponentref-instead-of-withref-after-rc-form140',
              );
            }
            return this.fieldsStore[key](...args);
          };
        });

        return {
          submitting: false,
        };
      },

      componentDidMount() {
        // 清理无用的字段
        this.cleanUpUselessFields();
      },

      componentWillReceiveProps(nextProps) {
        if (mapPropsToFields) {
          this.fieldsStore.updateFields(mapPropsToFields(nextProps));
        }
      },

      componentDidUpdate() {
        // 清理无用的字段
        this.cleanUpUselessFields();
      },

      /**
       * 收集返回控件字段名的信息
       * @notes yzs
       * @param {String} name 控件字段名
       * @param {String} action 事件名称. eg: onChange, onBlur
       * @param {Array} args 剩余参数
       * @returns {Object}
       */
      onCollectCommon(name, action, args) {
        const fieldMeta = this.fieldsStore.getFieldMeta(name);
        if (fieldMeta[action]) {
          fieldMeta[action](...args);
        } else if (fieldMeta.originalProps && fieldMeta.originalProps[action]) {
          fieldMeta.originalProps[action](...args);
        }

        // 从target.value or target.checked获取最新?值
        const value = fieldMeta.getValueFromEvent
          ? fieldMeta.getValueFromEvent(...args)
          : getValueFromEvent(...args);

        // 若设置了任一表单域的值发生改变时的回调 && value !== 状态机原来的value
        if (onValuesChange && value !== this.fieldsStore.getFieldValue(name)) {
          // 获取所有字段的值(全新对象)
          const valuesAll = this.fieldsStore.getAllValues();
          const valuesAllSet = {};
          valuesAll[name] = value;
          Object.keys(valuesAll).forEach(key =>
            set(valuesAllSet, key, valuesAll[key]),
          );

          // (props, changedValues, allValues) => void
          onValuesChange(
            {
              [formPropName]: this.getForm(),
              ...this.props,
            },
            set({}, name, value),
            valuesAllSet,
          );
        }
        const field = this.fieldsStore.getField(name);
        return { name, field: { ...field, value, touched: true }, fieldMeta };
      },

      /**
       * 仅收集对应控件字段名的信息, 比onCollectValidate少了校验和一些方法执行的顺序
       * @param {*} name_ 
       * @param {*} action 
       * @param  {...any} args 
       */
      onCollect(name_, action, ...args) {
        const { name, field, fieldMeta } = this.onCollectCommon(
          name_,
          action,
          args,
        );
        const { validate } = fieldMeta;

        this.fieldsStore.setFieldsAsDirty();

        const newField = {
          ...field,
          dirty: hasRules(validate),
        };
        this.setFields({
          [name]: newField,
        });
      },

      /**
       * 收集验证信息
       * @notes yzs
       * @param {String} name_ 控件字段名
       * @param {String} action 事件名称
       * @param  {Array} args 剩余参数
       */
      onCollectValidate(name_, action, ...args) {
        const { field, fieldMeta } = this.onCollectCommon(name_, action, args);
        const newField = {
          ...field,
          dirty: true,
        };

        this.fieldsStore.setFieldsAsDirty();

        this.validateFieldsInternal([newField], {
          action,
          options: {
            firstFields: !!fieldMeta.validateFirst,
          },
        });
      },

      /**
       * 获取缓存的绑定
       * @notes yzs
       * @param {*} name 
       * @param {*} action 
       * @param {*} fn 
       * @returns 
       */
      getCacheBind(name, action, fn) {
        if (!this.cachedBind[name]) {
          this.cachedBind[name] = {};
        }
        const cache = this.cachedBind[name];
        if (!cache[action] || cache[action].oriFn !== fn) {
          cache[action] = {
            fn: fn.bind(this, name, action),
            oriFn: fn,
          };
        }
        return cache[action].fn;
      },

      /**
       * // tag: 重要API
       * 包装控件获取字段装饰器
       * @notes yzs
       * @param {*} name 
       * @param {*} fieldOption 
       * @returns 
       */
      getFieldDecorator(name, fieldOption) {
        const props = this.getFieldProps(name, fieldOption);
        return fieldElem => {
          // We should put field in record if it is rendered
          this.renderFields[name] = true;

          const fieldMeta = this.fieldsStore.getFieldMeta(name);
          const originalProps = fieldElem.props;
          if (process.env.NODE_ENV !== 'production') {
            const valuePropName = fieldMeta.valuePropName;
            warning(
              !(valuePropName in originalProps),
              `\`getFieldDecorator\` will override \`${valuePropName}\`, ` +
              `so please don't set \`${valuePropName}\` directly ` +
              `and use \`setFieldsValue\` to set it.`,
            );
            const defaultValuePropName = `default${valuePropName[0].toUpperCase()}${valuePropName.slice(
              1,
            )}`;
            warning(
              !(defaultValuePropName in originalProps),
              `\`${defaultValuePropName}\` is invalid ` +
              `for \`getFieldDecorator\` will set \`${valuePropName}\`,` +
              ` please use \`option.initialValue\` instead.`,
            );
          }
          fieldMeta.originalProps = originalProps;
          fieldMeta.ref = fieldElem.ref;
          const decoratedFieldElem = React.cloneElement(fieldElem, {
            ...props,
            ...this.fieldsStore.getFieldValuePropValue(fieldMeta),
          });
          return supportRef(fieldElem) ? (
            decoratedFieldElem
          ) : (
            <FieldElemWrapper name={name} form={this}>
              {decoratedFieldElem}
            </FieldElemWrapper>
          );
        };
      },

      /**
       * // tag: 重要API
       * 获取字段的参数
       * @notes yzs
       * @param {String} name 控件字段名: 输入控件的唯一标识名称。
       * @param {Object} usersFieldOption 用户传入的字段配置项
       * @returns 
       */
      getFieldProps(name, usersFieldOption = {}) {
        if (!name) {
          throw new Error('Must call `getFieldProps` with valid name string!');
        }
        if (process.env.NODE_ENV !== 'production') {
          warning(
            this.fieldsStore.isValidNestedFieldName(name),
            `One field name cannot be part of another, e.g. \`a\` and \`a.b\`. Check field: ${name}`,
          );
          warning(
            !('exclusive' in usersFieldOption),
            '`option.exclusive` of `getFieldProps`|`getFieldDecorator` had been remove.',
          );
        }

        delete this.clearedFieldMetaCache[name];

        // 字段的配置项
        const fieldOption = {
          // 控件字段名
          name,
          trigger: DEFAULT_TRIGGER,
          // 子节点的值的属性，如 Switch 的是 'checked'
          valuePropName: 'value',
          validate: [],
          ...usersFieldOption,
        };

        const {
          rules,
          trigger,
          validateTrigger = trigger,
          validate,
        } = fieldOption;

        const fieldMeta = this.fieldsStore.getFieldMeta(name);
        if ('initialValue' in fieldOption) {
          fieldMeta.initialValue = fieldOption.initialValue;
        }

        // 表单控件的props
        const inputProps = {
          // ...{ [valuePropName]: fieldValue }
          ...this.fieldsStore.getFieldValuePropValue(fieldOption),
          ref: this.getCacheBind(name, `${name}__ref`, this.saveRef),
        };

        // 控件字段名的参数存储设置？
        // todo: 待深探
        if (fieldNameProp) {
          inputProps[fieldNameProp] = formName ? `${formName}_${name}` : name;
        }

        // 标准化校验规则
        const validateRules = normalizeValidateRules(
          validate,
          rules,
          validateTrigger,
        );

        // 获取所有校验触发方式, 例: ["onChange", "onBlur", "onChange"]
        const validateTriggers = getValidateTriggers(validateRules);
        validateTriggers.forEach(action => {
          if (inputProps[action]) return;
          // 给控件props的所有action绑定事件
          inputProps[action] = this.getCacheBind(
            name,
            action,
            this.onCollectValidate,
          );
        });

        // make sure that the value will be collect
        if (trigger && validateTriggers.indexOf(trigger) === -1) {
          inputProps[trigger] = this.getCacheBind(
            name,
            trigger,
            this.onCollect,
          );
        }

        const meta = {
          ...fieldMeta,
          ...fieldOption,
          validate: validateRules,
        };
        this.fieldsStore.setFieldMeta(name, meta);
        if (fieldMetaProp) {
          inputProps[fieldMetaProp] = meta;
        }

        if (fieldDataProp) {
          inputProps[fieldDataProp] = this.fieldsStore.getField(name);
        }

        // This field is rendered, record it
        this.renderFields[name] = true;

        return inputProps;
      },

      /**
       * 获取字段实例
       * @param {string} name 
       * @returns 
       */
      getFieldInstance(name) {
        return this.instances[name];
      },

      /**
       * 获取和action匹配的校验规则: 从字段元中
       * @notes yzs
       * @param {{validate: []}} fieldMeta 字段元对象
       * @param {String} action 触发事件名称.
       * @returns {Array}
       */
      getRules(fieldMeta, action) {
        const actionRules = fieldMeta.validate
          .filter(item => {
            // 筛出 !action 或 字段元对象的检验规则数组中的trigger收集子节点值的时机数组包含action
            return !action || item.trigger.indexOf(action) >= 0;
          })
          .map(item => item.rules);
        return flattenArray(actionRules);
      },

      /**
       * 更新设置所有字段
       * @notes yzs
       * @param {*} maybeNestedFields 
       * @param {*} callback 
       */
      setFields(maybeNestedFields, callback) {
        const fields = this.fieldsStore.flattenRegisteredFields(
          maybeNestedFields,
        );
        this.fieldsStore.setFields(fields);
        if (onFieldsChange) {
          const changedFields = Object.keys(fields).reduce(
            (acc, name) => set(acc, name, this.fieldsStore.getField(name)),
            {},
          );
          onFieldsChange(
            {
              [formPropName]: this.getForm(),
              ...this.props,
            },
            changedFields,
            this.fieldsStore.getNestedAllFields(),
          );
        }
        this.forceUpdate(callback);
      },

      /**
       * // tag: 重要API
       * 设置一组输入控件的值
       * @param { { [fieldName]: value } } changedValues 
       * @param { Function } callback 
       */
      setFieldsValue(changedValues, callback) {
        const { fieldsMeta } = this.fieldsStore;
        const values = this.fieldsStore.flattenRegisteredFields(changedValues);
        const newFields = Object.keys(values).reduce((acc, name) => {
          const isRegistered = fieldsMeta[name];
          if (process.env.NODE_ENV !== 'production') {
            warning(
              isRegistered,
              'Cannot use `setFieldsValue` until ' +
              'you use `getFieldDecorator` or `getFieldProps` to register it.',
            );
          }
          if (isRegistered) {
            const value = values[name];
            acc[name] = {
              value,
            };
          }
          return acc;
        }, {});
        this.setFields(newFields, callback);
        if (onValuesChange) {
          const allValues = this.fieldsStore.getAllValues();
          onValuesChange(
            {
              [formPropName]: this.getForm(),
              ...this.props,
            },
            changedValues,
            allValues,
          );
        }
      },

      saveRef(name, _, component) {
        if (!component) {
          const fieldMeta = this.fieldsStore.getFieldMeta(name);
          if (!fieldMeta.preserve) {
            // after destroy, delete data
            this.clearedFieldMetaCache[name] = {
              field: this.fieldsStore.getField(name),
              meta: fieldMeta,
            };
            this.clearField(name);
          }
          delete this.domFields[name];
          return;
        }
        this.domFields[name] = true;
        this.recoverClearedField(name);
        const fieldMeta = this.fieldsStore.getFieldMeta(name);
        if (fieldMeta) {
          const ref = fieldMeta.ref;
          if (ref) {
            if (typeof ref === 'string') {
              throw new Error(`can not set ref string for ${name}`);
            } else if (typeof ref === 'function') {
              ref(component);
            } else if (Object.prototype.hasOwnProperty.call(ref, 'current')) {
              ref.current = component;
            }
          }
        }
        this.instances[name] = component;
      },

      /**
       * 清理无用的字段
       * @notes yzs
       */
      cleanUpUselessFields() {
        const fieldList = this.fieldsStore.getAllFieldsName();
        const removedList = fieldList.filter(field => {
          const fieldMeta = this.fieldsStore.getFieldMeta(field);
          return (
            !this.renderFields[field] &&
            !this.domFields[field] &&
            !fieldMeta.preserve
          );
        });
        if (removedList.length) {
          removedList.forEach(this.clearField);
        }
        this.renderFields = {};
      },

      /**
       * 清空对应字段名的字段数据、字段元的对应元数据，并清空对应的实例对象, 和缓存绑定
       * @param {*} name 
       */
      clearField(name) {
        this.fieldsStore.clearField(name);
        delete this.instances[name];
        delete this.cachedBind[name];
      },

      /**
       * // tag: 重要API
       * 重置一组输入控件的值（为 initialValue）与状态，如不传入参数，则重置所有组件
       * @notes yzs
       * @param { string[] } ns 需要重置的字段名数组
       */
      resetFields(ns) {
        const newFields = this.fieldsStore.resetFields(ns);
        if (Object.keys(newFields).length > 0) {
          this.setFields(newFields);
        }
        if (ns) {
          const names = Array.isArray(ns) ? ns : [ns];
          names.forEach(name => delete this.clearedFieldMetaCache[name]);
        } else {
          this.clearedFieldMetaCache = {};
        }
      },

      /**
       * 恢复清除掉的字段
       * @param {*} name 
       */
      recoverClearedField(name) {
        if (this.clearedFieldMetaCache[name]) {
          this.fieldsStore.setFields({
            [name]: this.clearedFieldMetaCache[name].field,
          });
          this.fieldsStore.setFieldMeta(
            name,
            this.clearedFieldMetaCache[name].meta,
          );
          delete this.clearedFieldMetaCache[name];
        }
      },

      /**
       * // 内部校验所有字段
       * @notes yzs
       * @param {*} fields 所有字段最新信息
       * @param {*} param1 
       * @param {*} callback 回调
       * @returns 
       */
      validateFieldsInternal(
        fields,
        { fieldNames, action, options = {} },
        callback,
      ) {
        const allRules = {};
        const allValues = {};
        const allFields = {};
        const alreadyErrors = {};
        fields.forEach(field => {
          const name = field.name;
          // 若(对已经校验过的表单域, 在 validateTrigger 再次被触发时不再次校验) && (dirty === false)
          if (options.force !== true && field.dirty === false) {
            if (field.errors) {
              set(alreadyErrors, name, { errors: field.errors });
            }
            return;
          }
          const fieldMeta = this.fieldsStore.getFieldMeta(name);
          const newField = {
            ...field,
          };
          newField.errors = undefined;
          newField.validating = true;
          newField.dirty = true;
          allRules[name] = this.getRules(fieldMeta, action);
          // 这时对应字段的value是最新的
          allValues[name] = newField.value;
          allFields[name] = newField;
        });
        this.setFields(allFields);
        // in case normalize 以防正常化?
        Object.keys(allValues).forEach(f => {
          // 获取控件字段名对应的值: value or initialValue
          allValues[f] = this.fieldsStore.getFieldValue(f);
        });
        if (callback && isEmptyObject(allFields)) {
          callback(
            isEmptyObject(alreadyErrors) ? null : alreadyErrors,
            this.fieldsStore.getFieldsValue(fieldNames),
          );
          return;
        }

        const validator = new AsyncValidator(allRules);
        if (validateMessages) {
          validator.messages(validateMessages);
        }
        validator.validate(allValues, options, errors => {
          const errorsGroup = {
            ...alreadyErrors,
          };
          if (errors && errors.length) {
            errors.forEach(e => {
              const errorFieldName = e.field;
              let fieldName = errorFieldName;

              // Handle using array validation rule.
              // ref: https://github.com/ant-design/ant-design/issues/14275
              Object.keys(allRules).some(ruleFieldName => {
                const rules = allRules[ruleFieldName] || [];

                // Exist if match rule
                if (ruleFieldName === errorFieldName) {
                  fieldName = ruleFieldName;
                  return true;
                }

                // Skip if not match array type
                if (
                  rules.every(({ type }) => type !== 'array') ||
                  errorFieldName.indexOf(`${ruleFieldName}.`) !== 0
                ) {
                  return false;
                }

                // Exist if match the field name
                const restPath = errorFieldName.slice(ruleFieldName.length + 1);
                if (/^\d+$/.test(restPath)) {
                  fieldName = ruleFieldName;
                  return true;
                }

                return false;
              });

              const field = get(errorsGroup, fieldName);
              if (typeof field !== 'object' || Array.isArray(field)) {
                set(errorsGroup, fieldName, { errors: [] });
              }
              const fieldErrors = get(errorsGroup, fieldName.concat('.errors'));
              fieldErrors.push(e);
            });
          }
          const expired = [];
          const nowAllFields = {};
          Object.keys(allRules).forEach(name => {
            const fieldErrors = get(errorsGroup, name);
            const nowField = this.fieldsStore.getField(name);
            // avoid concurrency problems
            if (!eq(nowField.value, allValues[name])) {
              expired.push({
                name,
              });
            } else {
              nowField.errors = fieldErrors && fieldErrors.errors;
              nowField.value = allValues[name];
              nowField.validating = false;
              nowField.dirty = false;
              nowAllFields[name] = nowField;
            }
          });
          this.setFields(nowAllFields);
          if (callback) {
            if (expired.length) {
              expired.forEach(({ name }) => {
                const fieldErrors = [
                  {
                    message: `${name} need to revalidate`,
                    field: name,
                  },
                ];
                set(errorsGroup, name, {
                  expired: true,
                  errors: fieldErrors,
                });
              });
            }

            callback(
              isEmptyObject(errorsGroup) ? null : errorsGroup,
              this.fieldsStore.getFieldsValue(fieldNames),
            );
          }
        });
      },

      /**
       * // tag: 重要API
       * 校验并获取一组输入域的值与 Error，若 fieldNames 参数为空，则校验全部组件.
       * @notes yzs
       * @param { [fieldNames: String[]] } ns 字段名数组, 可选
       * @param { [options: Object] } opt 配置, 并新增了force字段. 可选
       * @param { callback: (errors, values) => void } cb 回调, 可选
       * @returns 
       */
      validateFields(ns, opt, cb) {
        const pending = new Promise((resolve, reject) => {
          const { names, options } = getParams(ns, opt, cb);
          let { callback } = getParams(ns, opt, cb);
          if (!callback || typeof callback === 'function') {
            const oldCb = callback;
            callback = (errors, values) => {
              if (oldCb) {
                oldCb(errors, values);
              }
              if (errors) {
                reject({ errors, values });
              } else {
                resolve(values);
              }
            };
          }
          const fieldNames = names
            ? this.fieldsStore.getValidFieldsFullName(names)
            : this.fieldsStore.getValidFieldsName();
          const fields = fieldNames
            .filter(name => {
              const fieldMeta = this.fieldsStore.getFieldMeta(name);
              return hasRules(fieldMeta.validate);
            })
            .map(name => {
              const field = this.fieldsStore.getField(name);
              field.value = this.fieldsStore.getFieldValue(name);
              return field;
            });
          if (!fields.length) {
            callback(null, this.fieldsStore.getFieldsValue(fieldNames));
            return;
          }
          if (!('firstFields' in options)) {
            options.firstFields = fieldNames.filter(name => {
              const fieldMeta = this.fieldsStore.getFieldMeta(name);
              return !!fieldMeta.validateFirst;
            });
          }
          this.validateFieldsInternal(
            fields,
            {
              fieldNames,
              options,
            },
            callback,
          );
        });
        pending.catch(e => {
          // eslint-disable-next-line no-console
          if (console.error && process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.error(e);
          }
          return e;
        });
        return pending;
      },

      isSubmitting() {
        if (
          process.env.NODE_ENV !== 'production' &&
          process.env.NODE_ENV !== 'test'
        ) {
          warning(
            false,
            '`isSubmitting` is deprecated. ' +
            "Actually, it's more convenient to handle submitting status by yourself.",
          );
        }
        return this.state.submitting;
      },

      /**
       * // tag: 弃用
       * 表单默认提交方法
       * @param {*} callback 
       */
      submit(callback) {
        if (
          process.env.NODE_ENV !== 'production' &&
          process.env.NODE_ENV !== 'test'
        ) {
          warning(
            false,
            '`submit` is deprecated. ' +
            "Actually, it's more convenient to handle submitting status by yourself.",
          );
        }
        const fn = () => {
          this.setState({
            submitting: false,
          });
        };
        this.setState({
          submitting: true,
        });
        callback(fn);
      },

      render() {
        const { wrappedComponentRef, ...restProps } = this.props; // eslint-disable-line
        const formProps = {
          [formPropName]: this.getForm(),
        };
        if (withRef) {
          if (
            process.env.NODE_ENV !== 'production' &&
            process.env.NODE_ENV !== 'test'
          ) {
            warning(
              false,
              '`withRef` is deprecated, please use `wrappedComponentRef` instead. ' +
              'See: https://github.com/react-component/form#note-use-wrappedcomponentref-instead-of-withref-after-rc-form140',
            );
          }
          formProps.ref = 'wrappedComponent';
        } else if (wrappedComponentRef) {
          formProps.ref = wrappedComponentRef;
        }
        const props = mapProps.call(this, {
          ...formProps,
          ...restProps,
        });
        return <WrappedComponent {...props} />;
      },
    });

    return argumentContainer(unsafeLifecyclesPolyfill(Form), WrappedComponent);
  };
}

export default createBaseForm;
