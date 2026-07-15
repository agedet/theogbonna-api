import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from 'src/database/database.service';
import { UserEntity } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
    constructor(private prisma: DatabaseService) {}

    async createUser(createUserDto: CreateUserDto): Promise<UserEntity> {
        const existingEmail = await this.prisma.users.findFirst({
            where: {
                email: createUserDto.email,
            },
        });

        if (existingEmail) {
            throw new Error("User with this email already exists");
        }

        if (createUserDto.phone_number) {
            const existingPhone = await this.prisma.users.findFirst({
                where: {
                    phone: createUserDto.phone_number,
                },
            });

            if (existingPhone) {
                throw new Error("User with this phone number already exists");
            }
        }

        const user = await this.prisma.users.create({
            data: {
                id: randomUUID(),
                encrypted_password: createUserDto.password,
                instance_id: "00000000-0000-0000-0000-000000000000",
                role: createUserDto.role,
                email: createUserDto.email,
                phone: createUserDto.phone_number,
                is_anonymous: false,
                profile: {
                    create: {
                        email: createUserDto.email,
                        first_name: createUserDto.first_name,
                        last_name: createUserDto.last_name,
                        phone_number: createUserDto.phone_number,
                    },
                },
            },
            include: {
                profile: true,
            },
        });

        return this.formatUser(user);
    }

    async fetchUsers(): Promise<UserEntity[]> {
        const users = await this.prisma.users.findMany({
            where: {
                deleted_at: null,
            },
            include: {
                profile: true,
            },
            orderBy: {
                created_at: "desc",
            },
        });

        const usersList = users.map((user) => this.formatUser(user));

        return usersList;
    }

    async findUserById(id: string): Promise<UserEntity> {
        const user = await this.prisma.users.findUnique({
            where: { id },
            include: {
                profile: true,
            },
        });

        if (!user) {
            throw new NotFoundException(`User not found`);
        }

        return this.formatUser(user);
    }

    async findUserByEmail(email: string): Promise<UserEntity | null> {
        const user = await this.prisma.users.findFirst({
            where: { email },
            include: {
                profile: true,
            },
        });

        if (!user) {
            return null;
        }

        return this.formatUser(user);
    }

    async findUserByPhone(phone: string): Promise<UserEntity | null> {
        const user = await this.prisma.users.findFirst({
        where: { phone },
            include: {
                profile: true,
            },
        });

        if (!user) {
            return null;
        }

        return this.formatUser(user);
    }

    formatUser(user: any): UserEntity {
        const isActive = user !== null;
        const status = isActive ? "active" : "invited";

        return {
            id: user.id,
            first_name: user?.profile?.first_name || "",
            last_name: user?.profile?.last_name || "",
            email: user.email || "",
            phone_number: user?.profile?.phone_number || "",
            job_title: user?.profile?.job_title || "",
            role: user.role || "",
            status: status,
            created_at: user.created_at ? new Date(user.created_at) : null,
            updated_at: user.updated_at ? new Date(user.updated_at) : null,
            deleted_at: user.deleted_at ? new Date(user.deleted_at) : null,
            is_anonymous: user.is_anonymous || false,
            instance_id: user.instance_id || "00000000-0000-0000-0000-000000000000",
            email_confirmed_at: user.email_confirmed_at
                ? new Date(user.email_confirmed_at)
                : null,
            otp_count: user.profile?.otp_count || 0,
            otp_generated_at: user.profile?.otp_generated_at
                ? new Date(user.profile.otp_generated_at)
                : null,
            password: user.encrypted_password || "",
            last_sign_in_at: user.last_sign_in_at
                ? new Date(user.last_sign_in_at)
                : null,
        }
    }
}
