# When to Mock

示例覆盖 Java (Mockito)、Python (unittest.mock / pytest)、TS/Vue。

Mock at **system boundaries** only:

- External APIs (payment, email, 第三方 HTTP 服务等)
- Databases (sometimes — prefer 测试库 / Testcontainers / in-memory)
- Time/randomness（时钟、随机数）
- File system (sometimes)

Don't mock:

- Your own classes/modules（自己的 Service / 组件）
- Internal collaborators（内部协作者）
- Anything you control（任何你能直接控制的东西）

## Designing for Mockability

在系统边界处，设计易于 mock 的接口。

### 1. 用依赖注入 (Dependency Injection)

把外部依赖传进来，而不是在内部 new 出来。

**Java**

```java
// 易于 mock —— 依赖从外部传入
public PaymentResult processPayment(Order order, PaymentClient client) {
    return client.charge(order.getTotal());
}

// 难以 mock —— 内部自行创建依赖
public PaymentResult processPayment(Order order) {
    PaymentClient client = new StripeClient(System.getenv("STRIPE_KEY"));
    return client.charge(order.getTotal());
}
```

> Spring 项目优先用构造器注入；测试时直接传入 Mockito 的 mock，无需启动容器。

**Python**

```python
# 易于 mock —— 依赖从外部传入
def process_payment(order, payment_client):
    return payment_client.charge(order.total)

# 难以 mock —— 内部硬编码依赖
def process_payment(order):
    client = StripeClient(os.environ["STRIPE_KEY"])
    return client.charge(order.total)
```

### 2. SDK 风格接口优于通用 fetcher

为每个外部操作建一个具体函数，而不是用一个带条件逻辑的通用函数。

**TS / Vue (前端 API 层)**

```typescript
// GOOD: 每个函数都能独立 mock
const api = {
  getUser: (id: string) => http.get(`/users/${id}`),
  getOrders: (userId: string) => http.get(`/users/${userId}/orders`),
  createOrder: (data: OrderInput) => http.post("/orders", data),
};

// BAD: mock 时需要在 mock 内部写条件逻辑
const api = {
  fetch: (endpoint: string, options?: RequestOptions) => http(endpoint, options),
};
```

SDK 风格的好处：

- 每个 mock 只返回一种确定的形状
- 测试 setup 里没有条件逻辑
- 一眼看出某个测试触达了哪些接口
- 每个接口独立的类型安全

> Java 同理：用 Feign / 接口化的 Client 暴露 `getUser` / `createOrder` 等具体方法，测试时按方法打桩，比 mock 一个通用 `request()` 清晰得多。
