# Good and Bad Tests

示例覆盖项目实际技术栈：后端 Java (JUnit5 / Mockito) 与 Python (pytest)，前端 TS / Vue (Vitest + Vue Test Utils)。原则跨语言通用。

## Good Tests

**Integration-style**: 通过真实的公共接口测试，而非 mock 内部部件。

### Java (JUnit5)

```java
// GOOD: 测试可观察的行为
@Test
void userCanCheckoutWithValidCart() {
    Cart cart = new Cart();
    cart.add(product);

    CheckoutResult result = checkoutService.checkout(cart, paymentMethod);

    assertEquals(Status.CONFIRMED, result.getStatus());
}
```

### Python (pytest)

```python
# GOOD: 测试可观察的行为
def test_user_can_checkout_with_valid_cart():
    cart = Cart()
    cart.add(product)

    result = checkout(cart, payment_method)

    assert result.status == "confirmed"
```

### TS / Vue (Vitest + Vue Test Utils)

```typescript
// GOOD: 测试用户能看到的行为，而非组件内部状态
test("submitting the cart shows a confirmation message", async () => {
  const wrapper = mount(CheckoutView, { props: { cart } });

  await wrapper.find("[data-test=submit]").trigger("click");

  expect(wrapper.text()).toContain("Order confirmed");
});
```

Characteristics:

- Tests behavior users/callers care about
- Uses public API only（后端：public 方法/HTTP 接口；前端：用户可见的渲染与交互）
- Survives internal refactors
- Describes WHAT, not HOW
- One logical assertion per test

## Bad Tests

**Implementation-detail tests**: 与内部结构耦合。

### Java — 断言内部协作者的调用（坏）

```java
// BAD: 测试实现细节，而非行为
@Test
void checkoutCallsPaymentServiceProcess() {
    PaymentService mockPayment = mock(PaymentService.class);

    checkoutService.checkout(cart, payment);

    verify(mockPayment).process(cart.getTotal()); // 重构内部就会断
}
```

### Python — 绕过接口直接查库验证（坏 vs 好）

```python
# BAD: 绕过接口，直接查数据库验证
def test_create_user_saves_to_database():
    create_user(name="Alice")
    row = db.execute("SELECT * FROM users WHERE name = ?", ["Alice"]).fetchone()
    assert row is not None

# GOOD: 通过接口验证可检索性
def test_create_user_makes_user_retrievable():
    user = create_user(name="Alice")
    retrieved = get_user(user.id)
    assert retrieved.name == "Alice"
```

Red flags:

- Mocking internal collaborators（mock 自己的类/服务）
- Testing private methods（测私有方法）
- Asserting on call counts/order（断言调用次数或顺序，如 Mockito `verify`、Vue 的内部方法 spy）
- Test breaks when refactoring without behavior change
- Test name describes HOW not WHAT
- Verifying through external means instead of interface（绕过接口直接查 DB / 直接读组件内部 state）
