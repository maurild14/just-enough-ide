@sealed
export class UserStore<T> {
  private marker = "{ not scope }" // }
  async getUser(id: string) {
    /* { ignored } */
    function pick() {
      return id
    }
    return pick()
  }
}
export interface User {
  id: string
}
export type UserId = string
export enum Role {
  Admin
}
export const loadUser = (id: string) => {
  return id
}
export const version = 1
