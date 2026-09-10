# Interface Design for Testability

好的接口让测试变得自然。示例覆盖 Java、Python、TS/Vue。

## 1. Accept dependencies, don't create them

接收依赖，而不是在内部创建。

**Java**

```java
// Testable —— 依赖传入
PaymentResult processOrder(Order order, PaymentGateway gateway) { ... }

// Hard to test —— 内部硬编码
PaymentResult processOrder(Order order) {
    PaymentGateway gateway = new StripeGateway();
    ...
}
```

**Python**

```python
# Testable
def process_order(order, payment_gateway): ...

# Hard to test
def process_order(order):
    gateway = StripeGateway()
    ...
```

## 2. Return results, don't produce side effects

返回结果，而非制造副作用 —— 纯函数最易测。

**Java**

```java
// Testable —— 返回结果
Discount calculateDiscount(Cart cart) { ... }

// Hard to test —— 直接修改入参
void applyDiscount(Cart cart) {
    cart.setTotal(cart.getTotal() - discount);
}
```

**TS / Vue**

```typescript
// Testable —— composable 返回纯计算结果
function calculateDiscount(cart: Cart): Discount { ... }

// Hard to test —— 直接改 reactive 状态
function applyDiscount(cart: Cart): void {
  cart.total -= discount;
}
```

> 前端：把纯计算抽到 composable / util 中返回值，组件只负责渲染。这样核心逻辑无需挂载组件即可测试。

## 3. Small surface area

- Fewer methods = fewer tests needed（接口方法越少，要测的越少）
- Fewer params = simpler test setup（参数越少，构造测试数据越简单）
- 与 [deep-modules.md](deep-modules.md) 一致：小接口 + 深实现
