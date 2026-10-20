public class Store<T> {
  class Row {
    void save() {
      persist();
    }
  }
  public T getUser(String id) {
    return load(id);
  }
}
interface Reader {
  String read();
}
enum Role {
  ADMIN
}
