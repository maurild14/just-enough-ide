namespace Acme;
public class Store<T> {
  class Row {
    void Save() {
      Persist();
    }
  }
  public T GetUser(string id) {
    return Load(id);
  }
}
interface Reader {
  string Read();
}
enum Role {
  Admin
}
