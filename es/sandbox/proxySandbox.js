import _toConsumableArray from "@babel/runtime/helpers/esm/toConsumableArray";
import _classCallCheck from "@babel/runtime/helpers/esm/classCallCheck";
import _createClass from "@babel/runtime/helpers/esm/createClass";
import { SandBoxType } from '../interfaces';
import { nativeGlobal, nextTask } from '../utils';
import { getTargetValue, setCurrentRunningApp } from './common';
/**
 * fastest(at most time) unique array method
 * @see https://jsperf.com/array-filter-unique/30
 */

function uniq(array) {
  return array.filter(function filter(element) {
    return element in this ? false : this[element] = true;
  }, Object.create(null));
} // zone.js will overwrite Object.defineProperty


var rawObjectDefineProperty = Object.defineProperty;
var variableWhiteListInDev = process.env.NODE_ENV === 'development' || window.__QIANKUN_DEVELOPMENT__ ? [// for react hot reload
// see https://github.com/facebook/create-react-app/blob/66bf7dfc43350249e2f09d138a20840dae8a0a4a/packages/react-error-overlay/src/index.js#L180
'__REACT_ERROR_OVERLAY_GLOBAL_HOOK__'] : []; // who could escape the sandbox

var variableWhiteList = [// FIXME System.js used a indirect call with eval, which would make it scope escape to global
// To make System.js works well, we write it back to global window temporary
// see https://github.com/systemjs/systemjs/blob/457f5b7e8af6bd120a279540477552a07d5de086/src/evaluate.js#L106
'System', // see https://github.com/systemjs/systemjs/blob/457f5b7e8af6bd120a279540477552a07d5de086/src/instantiate.js#L357
'__cjsWrapper'].concat(variableWhiteListInDev);
/*
 variables who are impossible to be overwrite need to be escaped from proxy sandbox for performance reasons
 */

var unscopables = {
  undefined: true,
  Array: true,
  Object: true,
  String: true,
  Boolean: true,
  Math: true,
  Number: true,
  Symbol: true,
  parseFloat: true,
  Float32Array: true
};
var useNativeWindowForBindingsProps = new Map([['fetch', true], ['mockDomAPIInBlackList', process.env.NODE_ENV === 'test']]);

function createFakeWindow(globalContext) {
  // map always has the fastest performance in has check scenario
  // see https://jsperf.com/array-indexof-vs-set-has/23
  var propertiesWithGetter = new Map();
  var fakeWindow = {};
  /*
   copy the non-configurable property of global to fakeWindow
   see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/getOwnPropertyDescriptor
   > A property cannot be reported as non-configurable, if it does not exists as an own property of the target object or if it exists as a configurable own property of the target object.
   */

  Object.getOwnPropertyNames(globalContext).filter(function (p) {
    var descriptor = Object.getOwnPropertyDescriptor(globalContext, p);
    return !(descriptor === null || descriptor === void 0 ? void 0 : descriptor.configurable);
  }).forEach(function (p) {
    var descriptor = Object.getOwnPropertyDescriptor(globalContext, p);

    if (descriptor) {
      var hasGetter = Object.prototype.hasOwnProperty.call(descriptor, 'get');
      /*
       make top/self/window property configurable and writable, otherwise it will cause TypeError while get trap return.
       see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/get
       > The value reported for a property must be the same as the value of the corresponding target object property if the target object property is a non-writable, non-configurable data property.
       */

      if (p === 'top' || p === 'parent' || p === 'self' || p === 'window' || process.env.NODE_ENV === 'test' && (p === 'mockTop' || p === 'mockSafariTop')) {
        descriptor.configurable = true;
        /*
         The descriptor of window.window/window.top/window.self in Safari/FF are accessor descriptors, we need to avoid adding a data descriptor while it was
         Example:
          Safari/FF: Object.getOwnPropertyDescriptor(window, 'top') -> {get: function, set: undefined, enumerable: true, configurable: false}
          Chrome: Object.getOwnPropertyDescriptor(window, 'top') -> {value: Window, writable: false, enumerable: true, configurable: false}
         */

        if (!hasGetter) {
          descriptor.writable = true;
        }
      }

      if (hasGetter) propertiesWithGetter.set(p, true); // freeze the descriptor to avoid being modified by zone.js
      // see https://github.com/angular/zone.js/blob/a5fe09b0fac27ac5df1fa746042f96f05ccb6a00/lib/browser/define-property.ts#L71

      rawObjectDefineProperty(fakeWindow, p, Object.freeze(descriptor));
    }
  });
  return {
    fakeWindow: fakeWindow,
    propertiesWithGetter: propertiesWithGetter
  };
}

var activeSandboxCount = 0;
/**
 * 基于 Proxy 实现的沙箱
 */

var ProxySandbox = /*#__PURE__*/function () {
  function ProxySandbox(name) {
    var _this = this;

    var globalContext = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : window;

    _classCallCheck(this, ProxySandbox);

    /** window 值变更记录 */
    this.updatedValueSet = new Set();
    this.sandboxRunning = true;
    this.latestSetProp = null;
    this.name = name;
    this.globalContext = globalContext;
    this.type = SandBoxType.Proxy;
    var updatedValueSet = this.updatedValueSet;

    var _createFakeWindow = createFakeWindow(globalContext),
        fakeWindow = _createFakeWindow.fakeWindow,
        propertiesWithGetter = _createFakeWindow.propertiesWithGetter;

    var descriptorTargetMap = new Map();

    var hasOwnProperty = function hasOwnProperty(key) {
      return fakeWindow.hasOwnProperty(key) || globalContext.hasOwnProperty(key);
    };

    var proxy = new Proxy(fakeWindow, {
      set: function set(target, p, value) {
        if (_this.sandboxRunning) {
          _this.registerRunningApp(name, proxy); // We must kept its description while the property existed in globalContext before


          if (!target.hasOwnProperty(p) && globalContext.hasOwnProperty(p)) {
            var descriptor = Object.getOwnPropertyDescriptor(globalContext, p);
            var writable = descriptor.writable,
                configurable = descriptor.configurable,
                enumerable = descriptor.enumerable;

            if (writable) {
              Object.defineProperty(target, p, {
                configurable: configurable,
                enumerable: enumerable,
                writable: writable,
                value: value
              });
            }
          } else {
            // @ts-ignore
            target[p] = value;
          }

          if (variableWhiteList.indexOf(p) !== -1) {
            // @ts-ignore
            globalContext[p] = value;
          }

          updatedValueSet.add(p);
          _this.latestSetProp = p;
          return true;
        }

        if (process.env.NODE_ENV === 'development') {
          console.warn("[qiankun] Set window.".concat(p.toString(), " while sandbox destroyed or inactive in ").concat(name, "!"));
        } // 在 strict-mode 下，Proxy 的 handler.set 返回 false 会抛出 TypeError，在沙箱卸载的情况下应该忽略错误


        return true;
      },
      get: function get(target, p) {
        _this.registerRunningApp(name, proxy);

        if (p === Symbol.unscopables) return unscopables; // avoid who using window.window or window.self to escape the sandbox environment to touch the really window
        // see https://github.com/eligrey/FileSaver.js/blob/master/src/FileSaver.js#L13

        if (p === 'window' || p === 'self') {
          return proxy;
        } // hijack globalWindow accessing with globalThis keyword


        if (p === 'globalThis') {
          return proxy;
        }

        if (p === 'top' || p === 'parent' || process.env.NODE_ENV === 'test' && (p === 'mockTop' || p === 'mockSafariTop')) {
          // if your master app in an iframe context, allow these props escape the sandbox
          if (globalContext === globalContext.parent) {
            return proxy;
          }

          return globalContext[p];
        } // proxy.hasOwnProperty would invoke getter firstly, then its value represented as globalContext.hasOwnProperty


        if (p === 'hasOwnProperty') {
          return hasOwnProperty;
        }

        if (p === 'document') {
          return document;
        }

        if (p === 'eval') {
          return eval;
        }

        var value = propertiesWithGetter.has(p) ? globalContext[p] : p in target ? target[p] : globalContext[p];
        /* Some dom api must be bound to native window, otherwise it would cause exception like 'TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation'
           See this code:
             const proxy = new Proxy(window, {});
             const proxyFetch = fetch.bind(proxy);
             proxyFetch('https://qiankun.com');
        */

        var boundTarget = useNativeWindowForBindingsProps.get(p) ? nativeGlobal : globalContext;
        return getTargetValue(boundTarget, value);
      },
      // trap in operator
      // see https://github.com/styled-components/styled-components/blob/master/packages/styled-components/src/constants.js#L12
      has: function has(target, p) {
        return p in unscopables || p in target || p in globalContext;
      },
      getOwnPropertyDescriptor: function getOwnPropertyDescriptor(target, p) {
        /*
         as the descriptor of top/self/window/mockTop in raw window are configurable but not in proxy target, we need to get it from target to avoid TypeError
         see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/handler/getOwnPropertyDescriptor
         > A property cannot be reported as non-configurable, if it does not exists as an own property of the target object or if it exists as a configurable own property of the target object.
         */
        if (target.hasOwnProperty(p)) {
          var descriptor = Object.getOwnPropertyDescriptor(target, p);
          descriptorTargetMap.set(p, 'target');
          return descriptor;
        }

        if (globalContext.hasOwnProperty(p)) {
          var _descriptor = Object.getOwnPropertyDescriptor(globalContext, p);

          descriptorTargetMap.set(p, 'globalContext'); // A property cannot be reported as non-configurable, if it does not exists as an own property of the target object

          if (_descriptor && !_descriptor.configurable) {
            _descriptor.configurable = true;
          }

          return _descriptor;
        }

        return undefined;
      },
      // trap to support iterator with sandbox
      ownKeys: function ownKeys(target) {
        return uniq(Reflect.ownKeys(globalContext).concat(Reflect.ownKeys(target)));
      },
      defineProperty: function defineProperty(target, p, attributes) {
        var from = descriptorTargetMap.get(p);
        /*
         Descriptor must be defined to native window while it comes from native window via Object.getOwnPropertyDescriptor(window, p),
         otherwise it would cause a TypeError with illegal invocation.
         */

        switch (from) {
          case 'globalContext':
            return Reflect.defineProperty(globalContext, p, attributes);

          default:
            return Reflect.defineProperty(target, p, attributes);
        }
      },
      deleteProperty: function deleteProperty(target, p) {
        _this.registerRunningApp(name, proxy);

        if (target.hasOwnProperty(p)) {
          // @ts-ignore
          delete target[p];
          updatedValueSet.delete(p);
          return true;
        }

        return true;
      },
      // makes sure `window instanceof Window` returns truthy in micro app
      getPrototypeOf: function getPrototypeOf() {
        return Reflect.getPrototypeOf(globalContext);
      }
    });
    this.proxy = proxy;
    activeSandboxCount++;
  }

  _createClass(ProxySandbox, [{
    key: "registerRunningApp",
    value: function registerRunningApp(name, proxy) {
      if (this.sandboxRunning) {
        setCurrentRunningApp({
          name: name,
          window: proxy
        }); // FIXME if you have any other good ideas
        // remove the mark in next tick, thus we can identify whether it in micro app or not
        // this approach is just a workaround, it could not cover all complex cases, such as the micro app runs in the same task context with master in some case

        nextTask(function () {
          setCurrentRunningApp(null);
        });
      }
    }
  }, {
    key: "active",
    value: function active() {
      if (!this.sandboxRunning) activeSandboxCount++;
      this.sandboxRunning = true;
    }
  }, {
    key: "inactive",
    value: function inactive() {
      var _this2 = this;

      if (process.env.NODE_ENV === 'development') {
        console.info("[qiankun:sandbox] ".concat(this.name, " modified global properties restore..."), _toConsumableArray(this.updatedValueSet.keys()));
      }

      if (--activeSandboxCount === 0) {
        variableWhiteList.forEach(function (p) {
          if (_this2.proxy.hasOwnProperty(p)) {
            // @ts-ignore
            delete _this2.globalContext[p];
          }
        });
      }

      this.sandboxRunning = false;
    }
  }]);

  return ProxySandbox;
}();

export { ProxySandbox as default };