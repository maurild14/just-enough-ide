pub struct User {
  id: String,
}
impl<T> User<T> {
  pub fn new() -> Self {
    build()
  }
}
pub trait Store {
  fn get(&self);
}
pub enum Role {
  Admin,
}
