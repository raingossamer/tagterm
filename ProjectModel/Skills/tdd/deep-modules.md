# Deep Modules

From "A Philosophy of Software Design":

**Deep module** = small interface + lots of implementation

```
┌─────────────────────┐
│   Small Interface   │  ← Few methods, simple params
├─────────────────────┤
│                     │
│                     │
│  Deep Implementation│  ← Complex logic hidden
│                     │
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid)

```
┌─────────────────────────────────┐
│       Large Interface           │  ← Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  ← Just passes through
└─────────────────────────────────┘
```

When designing interfaces, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

## 为什么深模块更可测

小接口意味着**测试只需在边界上断言行为**，无需关心内部如何实现 —— 这正是 [tests.md](tests.md) 推崇的方式。内部实现可以大改，边界测试仍然通过。

**Java —— 深模块（推荐）**

```java
// 小接口：一个方法，简单参数
public interface PricingEngine {
    Price quote(Cart cart);   // 折扣、税费、汇率、促销规则全部隐藏在内部
}
```

调用方和测试都只面对 `quote(cart)`，内部的折扣/税费/促销逻辑随便重构。

**Python —— 浅模块（避免）**

```python
# 大接口：把内部步骤全暴露出来，调用方被迫自己编排
class Pricing:
    def apply_discount(self, cart): ...
    def apply_tax(self, cart): ...
    def apply_promo(self, cart): ...
    def convert_currency(self, cart): ...
# 调用方必须按正确顺序调用 4 个方法 —— 接口几乎和实现一样复杂
```

> 经验法则：如果调用方需要了解"内部步骤的正确调用顺序"，这个模块就太浅了。把编排逻辑收进模块内部，只暴露一个 `quote` / `price`。
